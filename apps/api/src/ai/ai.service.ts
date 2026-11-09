import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CALCULATE_IMPACT_PROMPT } from '../prompts/calculate-impact';
import { ENHANCE_COMMIT_PROMPT } from '../prompts/enhance-commit';
import { GENERATE_APPRAISAL_PROMPT } from '../prompts/generate-appraisal';
import { GENERATE_PROMOTION_PROMPT } from '../prompts/generate-promotion';
import { GENERATE_RESUME_PROMPT } from '../prompts/generate-resume';

interface CommitContext {
  message: string;
  repo: string;
  additions: number;
  deletions: number;
}

interface ActivityData {
  commits: { message: string; repo: string; additions: number; deletions: number }[];
  prs: { title: string; repo: string; state: string; mergedAt?: string | null }[];
  reviews: { comments: number; approved: boolean }[];
}

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);
  private readonly client: Anthropic;
  private readonly model = 'claude-sonnet-4-20250514';

  constructor(private configService: ConfigService) {
    this.client = new Anthropic({
      apiKey: this.configService.get<string>('ANTHROPIC_API_KEY'),
    });
  }

  async enhanceCommitMessage(context: CommitContext) {
    const prompt = ENHANCE_COMMIT_PROMPT.replace('{{repo}}', context.repo)
      .replace('{{additions}}', String(context.additions))
      .replace('{{deletions}}', String(context.deletions))
      .replace('{{message}}', context.message);

    return this.callClaude<{ enhanced: string; category: string }>(prompt);
  }

  async generateResumeBullets(
    activityData: ActivityData,
    dateRange: { from: string; to: string },
    role: string,
  ) {
    const topRepos = this.getTopRepos(activityData.commits);
    const sampleCommits = activityData.commits
      .slice(0, 20)
      .map((c) => `- [${c.repo}] ${c.message}`)
      .join('\n');
    const samplePRs = activityData.prs
      .slice(0, 15)
      .map((p) => `- [${p.repo}] ${p.title} (${p.state})`)
      .join('\n');

    const prompt = GENERATE_RESUME_PROMPT.replaceAll('{{role}}', role)
      .replace('{{dateRange}}', `${dateRange.from} to ${dateRange.to}`)
      .replace('{{commitsCount}}', String(activityData.commits.length))
      .replace('{{repoCount}}', String(topRepos.length))
      .replace('{{prsCount}}', String(activityData.prs.length))
      .replace('{{reviewsCount}}', String(activityData.reviews.length))
      .replace('{{topRepos}}', topRepos.map((r) => r.repo).join(', '))
      .replace('{{sampleCommits}}', sampleCommits)
      .replace('{{samplePRs}}', samplePRs);

    return this.callClaude<{ bullets: { text: string; category: string; impact: string }[] }>(
      prompt,
    );
  }

  async generateAppraisalReport(
    activityData: ActivityData,
    period: string,
    month: number,
    year: number,
  ) {
    const prsMerged = activityData.prs.filter((p) => p.state === 'MERGED').length;
    const contributions = activityData.prs
      .filter((p) => p.mergedAt)
      .slice(0, 10)
      .map((p) => `- ${p.title} (${p.repo})`)
      .join('\n');
    const sampleWork = activityData.commits
      .slice(0, 15)
      .map((c) => `- ${c.message} (+${c.additions}/-${c.deletions})`)
      .join('\n');

    const prompt = GENERATE_APPRAISAL_PROMPT.replace('{{period}}', period)
      .replace('{{month}}', String(month))
      .replace('{{year}}', String(year))
      .replace('{{commitsCount}}', String(activityData.commits.length))
      .replace('{{prsCount}}', String(activityData.prs.length))
      .replace('{{prsMerged}}', String(prsMerged))
      .replace('{{reviewsCount}}', String(activityData.reviews.length))
      .replace('{{repoCount}}', String(this.getTopRepos(activityData.commits).length))
      .replace('{{contributions}}', contributions)
      .replace('{{sampleWork}}', sampleWork);

    return this.callClaude(prompt);
  }

  async generatePromotionPacket(
    currentRole: string,
    targetRole: string,
    activityData: ActivityData,
  ) {
    const prsMerged = activityData.prs.filter((p) => p.state === 'MERGED').length;
    const totalAdditions = activityData.commits.reduce((sum, c) => sum + c.additions, 0);
    const totalDeletions = activityData.commits.reduce((sum, c) => sum + c.deletions, 0);
    const avgPRSize =
      activityData.prs.length > 0
        ? Math.round((totalAdditions + totalDeletions) / activityData.prs.length)
        : 0;

    const notableWork = activityData.prs
      .slice(0, 10)
      .map((p) => `- ${p.title} (${p.repo})`)
      .join('\n');
    const collaborationEvidence = `- Code reviews completed: ${activityData.reviews.length}\n- Reviews with approvals: ${activityData.reviews.filter((r) => r.approved).length}`;

    const prompt = GENERATE_PROMOTION_PROMPT.replace('{{currentRole}}', currentRole)
      .replaceAll('{{targetRole}}', targetRole)
      .replace('{{commitsCount}}', String(activityData.commits.length))
      .replace('{{prsCount}}', String(activityData.prs.length))
      .replace('{{prsMerged}}', String(prsMerged))
      .replace('{{reviewsCount}}', String(activityData.reviews.length))
      .replace('{{repoCount}}', String(this.getTopRepos(activityData.commits).length))
      .replace('{{avgPRSize}}', String(avgPRSize))
      .replace('{{notableWork}}', notableWork)
      .replace('{{collaborationEvidence}}', collaborationEvidence);

    return this.callClaude(prompt);
  }

  async calculateImpactScore(activityData: ActivityData, month: number, year: number) {
    const prsMerged = activityData.prs.filter((p) => p.state === 'MERGED').length;
    const totalAdditions = activityData.commits.reduce((sum, c) => sum + c.additions, 0);
    const totalDeletions = activityData.commits.reduce((sum, c) => sum + c.deletions, 0);
    const workSamples = activityData.commits
      .slice(0, 10)
      .map((c) => `- ${c.message} [${c.repo}] (+${c.additions}/-${c.deletions})`)
      .join('\n');

    const prompt = CALCULATE_IMPACT_PROMPT.replace('{{month}}', String(month))
      .replace('{{year}}', String(year))
      .replace('{{commitsCount}}', String(activityData.commits.length))
      .replace('{{prsCount}}', String(activityData.prs.length))
      .replace('{{prsMerged}}', String(prsMerged))
      .replace('{{reviewsCount}}', String(activityData.reviews.length))
      .replace('{{totalAdditions}}', String(totalAdditions))
      .replace('{{totalDeletions}}', String(totalDeletions))
      .replace('{{repoCount}}', String(this.getTopRepos(activityData.commits).length))
      .replace('{{workSamples}}', workSamples);

    return this.callClaude<{
      overall: number;
      featureDelivery: number;
      codeQuality: number;
      collaboration: number;
      leadership: number;
      highlights: string[];
    }>(prompt);
  }

  private async callClaude<T = Record<string, unknown>>(prompt: string, retries = 3): Promise<T> {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const message = await this.client.messages.create({
          model: this.model,
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        });

        const content = message.content[0];
        if (content.type !== 'text') {
          throw new Error('Unexpected response type');
        }

        const jsonMatch = /\{[\s\S]*\}/.exec(content.text);
        if (!jsonMatch) {
          throw new Error('No JSON found in response');
        }

        return JSON.parse(jsonMatch[0]) as T;
      } catch (error) {
        this.logger.warn(`AI call attempt ${attempt + 1} failed: ${String(error)}`);
        if (attempt === retries - 1) throw error;
        await this.delay(Math.pow(2, attempt) * 1000);
      }
    }
    throw new Error('All retries exhausted');
  }

  private getTopRepos(commits: { repo: string }[]) {
    const repoMap = new Map<string, number>();
    for (const c of commits) {
      repoMap.set(c.repo, (repoMap.get(c.repo) || 0) + 1);
    }
    return Array.from(repoMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([repo, count]) => ({ repo, count }));
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
