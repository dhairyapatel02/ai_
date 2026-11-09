import { AIService } from './ai.service';

import type { ConfigService } from '@nestjs/config';

type CreateFn = jest.Mock<Promise<{ content: { type: string; text?: string }[] }>, [unknown]>;

const activity = {
  commits: [
    { message: 'feat: add billing', repo: 'acme/api', additions: 120, deletions: 10 },
    { message: 'fix: null check', repo: 'acme/api', additions: 3, deletions: 1 },
    { message: 'chore: bump deps', repo: 'acme/web', additions: 50, deletions: 40 },
  ],
  prs: [
    { title: 'Billing v1', repo: 'acme/api', state: 'MERGED', mergedAt: '2026-10-02T00:00:00Z' },
    { title: 'WIP search', repo: 'acme/web', state: 'OPEN', mergedAt: null },
  ],
  reviews: [
    { comments: 1, approved: true },
    { comments: 0, approved: false },
  ],
};

function textResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

/** Builds the service with the Anthropic client replaced by a mock (never call the real API). */
function createService() {
  const config = { get: jest.fn().mockReturnValue('test-key') } as unknown as ConfigService;
  const service = new AIService(config);
  const create: CreateFn = jest.fn();
  Object.assign(service, { client: { messages: { create } } });
  // Skip the real exponential backoff between retries.
  jest.spyOn(service as unknown as { delay: () => Promise<void> }, 'delay').mockResolvedValue();
  const promptOf = (call = 0) => {
    const params = create.mock.calls[call]?.[0] as { messages: { content: string }[] };
    return params.messages[0]?.content ?? '';
  };
  return { service, create, promptOf };
}

describe('AIService (characterization, Anthropic mocked)', () => {
  it('builds the resume prompt from activity counts, top repos and samples', async () => {
    const { service, create, promptOf } = createService();
    create.mockResolvedValue(textResponse('{"bullets":[]}'));

    await service.generateResumeBullets(
      activity,
      { from: '2026-10-01', to: '2026-10-31' },
      'backend',
    );

    const prompt = promptOf();
    expect(prompt).toContain('Role: backend');
    expect(prompt).toContain('Date Range: 2026-10-01 to 2026-10-31');
    expect(prompt).toContain('- Commits: 3 (across 2 repositories)');
    expect(prompt).toContain('- Pull Requests Merged: 2'); // AI-07: actually total PRs
    expect(prompt).toContain('- Code Reviews Completed: 2');
    expect(prompt).toContain('- Top Repositories: acme/api, acme/web');
    expect(prompt).toContain('- [acme/api] feat: add billing');
    expect(prompt).toContain('- [acme/web] WIP search (OPEN)');
    expect(prompt).toContain('Tailor language to the backend role');
    expect(prompt).not.toContain('{{');
  });

  it('builds the impact-score prompt with merged counts and LOC totals', async () => {
    const { service, create, promptOf } = createService();
    create.mockResolvedValue(
      textResponse(
        '{"overall":70,"featureDelivery":70,"codeQuality":70,"collaboration":70,"leadership":70,"highlights":[]}',
      ),
    );

    await service.calculateImpactScore(activity, 10, 2026);

    const prompt = promptOf();
    expect(prompt).toContain('Activity Data for 10/2026');
    expect(prompt).toContain('- Pull Requests: 2 (1 merged)');
    expect(prompt).toContain('- Lines Added: 173');
    expect(prompt).toContain('- Lines Deleted: 51');
    expect(prompt).not.toContain('{{');
  });

  it('extracts the JSON object from surrounding prose and sends the configured request', async () => {
    const { service, create } = createService();
    create.mockResolvedValue(
      textResponse('Sure! Here you go:\n{"bullets":[{"text":"x"}]}\nThanks'),
    );

    const result = await service.generateResumeBullets(
      activity,
      { from: 'a', to: 'b' },
      'frontend',
    );

    expect(result).toEqual({ bullets: [{ text: 'x' }] });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-20250514', max_tokens: 4096 }),
    );
  });

  it('retries up to 3 times and then throws the last error', async () => {
    const { service, create } = createService();
    create.mockResolvedValue(textResponse('no json here'));

    await expect(service.generatePromotionPacket('Senior', 'Staff', activity)).rejects.toThrow(
      'No JSON found in response',
    );
    expect(create).toHaveBeenCalledTimes(3);
  });

  it.skip('AI-04: does not retry non-retryable errors such as 400/401 or parse failures', async () => {
    const { service, create } = createService();
    create.mockResolvedValue(textResponse('no json here'));
    await expect(service.generatePromotionPacket('Senior', 'Staff', activity)).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.skip("AI-05: values containing `$&` / `$'` are inserted into prompts verbatim", async () => {
    const { service, create, promptOf } = createService();
    create.mockResolvedValue(textResponse('{"bullets":[]}'));
    await service.generateResumeBullets(
      { ...activity, commits: [{ message: 'cost $& fix', repo: 'r', additions: 1, deletions: 1 }] },
      { from: 'a', to: 'b' },
      'backend',
    );
    expect(promptOf()).toContain('cost $& fix');
  });

  it.todo('AI-02: model ID comes from ANTHROPIC_MODEL_* config instead of being hard-coded (P08)');
});
