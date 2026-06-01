import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { GitHubService } from '../github/github.service';

interface SyncJobData {
  userId: string;
  integrationId: string;
  accessToken: string;
}

@Processor('github-sync')
export class SyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(
    private prisma: PrismaService,
    private githubService: GitHubService,
  ) {
    super();
  }

  async process(job: Job<SyncJobData>) {
    const { userId, integrationId, accessToken } = job.data;
    this.logger.log(`Starting sync for user ${userId}`);

    try {
      const username = await this.githubService.getUsername(accessToken);
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const since = sixMonthsAgo.toISOString();

      await job.updateProgress(10);

      // Fetch repos
      const repos = await this.githubService.fetchUserRepos(accessToken);
      const recentRepos = repos.slice(0, 30); // Limit to 30 most recent
      await job.updateProgress(20);

      // Fetch commits
      let totalCommits = 0;
      for (let i = 0; i < recentRepos.length; i++) {
        const repoName = recentRepos[i];
        const commits = await this.githubService.fetchCommits(accessToken, repoName, username, since);

        for (const commit of commits) {
          await this.prisma.commit.upsert({
            where: { userId_sha: { userId, sha: commit.sha } },
            update: { additions: commit.additions, deletions: commit.deletions },
            create: {
              userId,
              integrationId,
              sha: commit.sha,
              message: commit.message,
              repo: commit.repo,
              branch: commit.branch,
              additions: commit.additions,
              deletions: commit.deletions,
              timestamp: new Date(commit.timestamp),
            },
          });
          totalCommits++;
        }

        await job.updateProgress(20 + Math.round((i / recentRepos.length) * 30));
      }

      // Fetch PRs
      let totalPRs = 0;
      for (let i = 0; i < recentRepos.length; i++) {
        const repoName = recentRepos[i];
        const prs = await this.githubService.fetchPullRequests(accessToken, repoName, username, since);

        for (const pr of prs) {
          await this.prisma.pullRequest.upsert({
            where: {
              userId_repo_number: { userId, repo: pr.repo, number: pr.number },
            },
            update: {
              title: pr.title,
              body: pr.body,
              state: pr.state,
              mergedAt: pr.mergedAt ? new Date(pr.mergedAt) : null,
            },
            create: {
              userId,
              integrationId,
              number: pr.number,
              title: pr.title,
              body: pr.body,
              state: pr.state,
              repo: pr.repo,
              mergedAt: pr.mergedAt ? new Date(pr.mergedAt) : null,
              timestamp: new Date(pr.createdAt),
            },
          });
          totalPRs++;
        }

        await job.updateProgress(50 + Math.round((i / recentRepos.length) * 20));
      }

      // Fetch reviews
      let totalReviews = 0;
      for (let i = 0; i < Math.min(recentRepos.length, 15); i++) {
        const repoName = recentRepos[i];
        const reviews = await this.githubService.fetchReviews(accessToken, repoName, username, since);

        for (const review of reviews) {
          const dbPR = await this.prisma.pullRequest.findFirst({
            where: { repo: review.repo, userId, number: review.prNumber },
          });

          if (dbPR) {
            const timestamp = new Date(review.submittedAt);
            await this.prisma.codeReview.upsert({
              where: {
                userId_prId_timestamp: { userId, prId: dbPR.id, timestamp },
              },
              update: {
                comments: review.body ? 1 : 0,
                approved: review.state === 'APPROVED',
              },
              create: {
                userId,
                prId: dbPR.id,
                comments: review.body ? 1 : 0,
                approved: review.state === 'APPROVED',
                timestamp,
              },
            });
            totalReviews++;
          }
        }

        await job.updateProgress(70 + Math.round((i / 15) * 30));
      }

      this.logger.log(`Sync complete: ${totalCommits} commits, ${totalPRs} PRs, ${totalReviews} reviews`);
      return { totalCommits, totalPRs, totalReviews };
    } catch (error) {
      this.logger.error(`Sync failed for user ${userId}: ${error}`);
      throw error;
    }
  }
}
