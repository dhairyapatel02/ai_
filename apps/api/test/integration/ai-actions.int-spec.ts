import request from 'supertest';

import { DigestSummaryService } from '../../src/documents/digest-summary.service';
import { parseSse, startAiWorker } from '../utils/ai-worker';
import { readStream, seedOctoberActivity } from '../utils/ai-fixtures';
import { createTestApp, type TestApp } from '../utils/app';
import { bearer } from '../utils/auth';
import { resetDatabase, resetRedisState } from '../utils/db';
import { autoReply, startFakeAnthropic, type FakeAnthropic } from '../utils/fake-anthropic';
import { buildFactories, type Factories } from '../utils/factories';

/** Quick AI actions (ai.quick, fast model): impact highlights, achievement statements, digest. */
describe('Impact highlights, achievement statements, digest summary (integration)', () => {
  let t: TestApp;
  let f: Factories;
  let fake: FakeAnthropic;
  let worker: { close: () => Promise<void> };
  let userId: string;
  let as: string;
  const server = () => t.app.getHttpServer();

  beforeAll(async () => {
    fake = await startFakeAnthropic(autoReply);
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.ANTHROPIC_BASE_URL = fake.url;
    t = await createTestApp();
    f = buildFactories(t.prisma);
    worker = await startAiWorker(t.app);
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await resetRedisState();
    fake.reset();
    const user = await f.user();
    userId = user.id;
    as = bearer(user.id);
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
    await fake.close();
    delete process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:9';
  });

  it('POST /impact/highlights: 201 new (fast model), 200 cached; GET /impact links it without AI', async () => {
    await seedOctoberActivity(f, userId);
    const before = await request(server()).get('/api/impact?period=month:2026-10').set('authorization', as).expect(200);
    expect(before.body.data.highlights).toBeNull();

    const first = await request(server())
      .post('/api/impact/highlights')
      .set('authorization', as)
      .send({ period: 'month:2026-10' })
      .expect(201);
    expect(first.body.data).toMatchObject({
      cached: false,
      document: { type: 'impact_narrative', status: 'ready', currentVersion: 1 },
      content: { summary: { id: 's1' }, highlights: [{ id: 'h1' }, { id: 'h2' }] },
    });
    expect(first.body.data.evidence.length).toBeGreaterThan(0);
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0].body.model).toBe('claude-haiku-5-5');
    expect(fake.requests[0].body.output_config).toMatchObject({ effort: 'low' });
    expect(fake.requests[0].body.fallbacks).toBeUndefined();
    expect(fake.requests[0].body.messages[0].content).toContain('"impactScore"');

    const second = await request(server())
      .post('/api/impact/highlights')
      .set('authorization', as)
      .send({ period: 'month:2026-10' })
      .expect(200);
    expect(second.body.data.cached).toBe(true);
    expect(fake.requests).toHaveLength(1);

    const after = await request(server()).get('/api/impact?period=month:2026-10').set('authorization', as).expect(200);
    expect(after.body.data.highlights).toEqual({ documentId: first.body.data.document.id, status: 'ready' });
    expect(fake.requests).toHaveLength(1);

    const usage = await request(server()).get('/api/me/usage').set('authorization', as).expect(200);
    expect(usage.body.data.quick).toEqual({ used: 1, limit: 100 });
    expect(usage.body.data.generations.used).toBe(0);
  });

  it('highlights on an insufficient score → 409 CONFLICT insufficient_data (no AI call)', async () => {
    const gh = await f.integration(userId);
    await f.pullRequest(userId, gh.id, { mergedAt: new Date('2026-10-16T12:00:00Z') });
    const res = await request(server())
      .post('/api/impact/highlights')
      .set('authorization', as)
      .send({ period: 'month:2026-10' })
      .expect(409);
    expect(res.body.error).toMatchObject({ code: 'CONFLICT', details: { reason: 'insufficient_data' } });
    expect(fake.requests).toHaveLength(0);
  });

  it('quick-action quota (FREE 100/month) → 402; upstream outage → 503 without payload', async () => {
    await seedOctoberActivity(f, userId);
    await t.prisma.aiUsage.createMany({
      data: Array.from({ length: 100 }, () => ({
        userId,
        feature: 'ACHIEVEMENT_STATEMENT' as const,
        promptId: 'achievement-statement',
        promptVersion: 1,
        model: 'm',
        latencyMs: 1,
        status: 'SUCCEEDED' as const,
      })),
    });
    const quota = await request(server())
      .post('/api/impact/highlights')
      .set('authorization', as)
      .send({ period: 'month:2026-10' })
      .expect(402);
    expect(quota.body.error.details).toMatchObject({ feature: 'quick', used: 100, limit: 100 });

    await t.prisma.aiUsage.deleteMany({});
    fake.queue.push(
      { status: 529, errorType: 'overloaded_error' },
      { status: 529, errorType: 'overloaded_error' },
      { status: 529, errorType: 'overloaded_error' },
    );
    const outage = await request(server())
      .post('/api/impact/highlights')
      .set('authorization', as)
      .send({ period: 'month:2026-10' })
      .expect(503);
    expect(outage.body.error).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', details: { provider: 'anthropic' } });
    expect(JSON.stringify(outage.body)).not.toContain('req_fake');
    expect(fake.requests).toHaveLength(3); // 1 + AI_MAX_RETRIES (2)
    expect(await t.prisma.aiUsage.count({ where: { countsTowardQuota: true } })).toBe(0);
  });

  it('POST /ai/achievement-statement for an own PR or commit (cached); reviewed/foreign PR → 404', async () => {
    const { prs, commit } = await seedOctoberActivity(f, userId);
    const res = await request(server())
      .post('/api/ai/achievement-statement')
      .set('authorization', as)
      .send({ source: { kind: 'pull_request', id: prs[0].id } })
      .expect(200);
    expect(res.body.data).toEqual({
      title: 'Shipped an API improvement',
      statement: 'Improved the API with a focused change.',
      category: 'delivery',
      citations: [`PR-acme/api#${prs[0].number}`],
      cached: false,
    });
    const again = await request(server())
      .post('/api/ai/achievement-statement')
      .set('authorization', as)
      .send({ source: { kind: 'pull_request', id: prs[0].id } })
      .expect(200);
    expect(again.body.data.cached).toBe(true);
    expect(fake.requests).toHaveLength(1);
    // Only the one item is sent, with its injected text inside the evidence block.
    const sentEvidence = /<evidence>\n([\s\S]*?)\n<\/evidence>/.exec(fake.requests[0].body.messages[0].content)![1];
    expect(JSON.parse(sentEvidence).items).toHaveLength(1);

    const fromCommit = await request(server())
      .post('/api/ai/achievement-statement')
      .set('authorization', as)
      .send({ source: { kind: 'commit', id: commit.id } })
      .expect(200);
    expect(fromCommit.body.data.citations[0]).toMatch(/^C-acme\/api@[0-9a-f]{7}$/);

    const reviewed = await t.prisma.pullRequest.findFirstOrThrow({ where: { userId, isAuthoredByUser: false } });
    await request(server())
      .post('/api/ai/achievement-statement')
      .set('authorization', as)
      .send({ source: { kind: 'pull_request', id: reviewed.id } })
      .expect(404);
    const stranger = await f.user();
    await request(server())
      .post('/api/ai/achievement-statement')
      .set('authorization', bearer(stranger.id))
      .send({ source: { kind: 'pull_request', id: prs[0].id } })
      .expect(404);
  });

  it('digest summary (worker-only): generated once per week inputs, null without evidence', async () => {
    await seedOctoberActivity(f, userId);
    const digest = t.app.get(DigestSummaryService);
    const result = await digest.summarize(userId, '2026-10-19');
    expect(result).toMatchObject({ cached: false, content: { summary: { id: 's1' } } });
    expect((await digest.summarize(userId, '2026-10-19'))?.cached).toBe(true);
    expect(fake.requests).toHaveLength(1);
    expect(await digest.summarize(userId, '2026-01-05')).toBeNull();
    const doc = await t.prisma.generatedDocument.findFirstOrThrow({ where: { userId, type: 'DIGEST_SUMMARY' } });
    expect(doc.title).toContain('Weekly digest');
    // Quick types never stream: a stream request replays status + done from the database.
    const events = parseSse((await readStream(t, `/api/documents/${doc.id}/stream`, as)).body as string);
    expect(events.map((e) => e.event)).toEqual(['status', 'done']);
  });
});
