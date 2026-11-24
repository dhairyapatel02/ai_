import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';

import { DigestBuilder } from '../../src/email/digest-builder.service';
import { DigestScheduler } from '../../src/email/digest-scheduler.service';
import { DigestService } from '../../src/email/digest.service';
import { EMAIL_QUEUE, EMAIL_TRANSPORT, digestJobId } from '../../src/email/email.constants';
import { MemoryEmailTransport } from '../../src/email/transports';
import { createUnsubscribeToken } from '../../src/email/unsubscribe-token';
import { createTestApp, type TestApp } from '../utils/app';
import { bearer } from '../utils/auth';
import { resetDatabase, resetRedisState } from '../utils/db';
import { buildFactories, type Factories } from '../utils/factories';
import { TEST_SECRETS } from '../utils/test-env';

import type { Env } from '../../src/config/env';
import type { DigestSummaryService } from '../../src/documents/digest-summary.service';
import type { Queue } from 'bullmq';

/**
 * Weekly digest (F-63): fan-out with a fake clock across time zones, idempotent delivery,
 * opt-out, empty weeks, provider failure + retry, optional AI summary (escaped), unsubscribe
 * without login, and the preview endpoint. Email goes to the in-memory transport only.
 */
describe('Weekly digest and notifications (integration)', () => {
  let t: TestApp;
  let f: Factories;
  let transport: MemoryEmailTransport;
  let queue: Queue;
  const server = () => t.app.getHttpServer();
  const summarize = jest.fn();

  const service = (withSummary = false) =>
    new DigestService(
      t.prisma,
      t.app.get(DigestBuilder),
      t.app.get<ConfigService<Env, true>>(ConfigService),
      transport,
      withSummary ? ({ summarize } as unknown as DigestSummaryService) : undefined,
    );

  beforeAll(async () => {
    t = await createTestApp();
    f = buildFactories(t.prisma);
    transport = t.app.get(EMAIL_TRANSPORT);
    queue = t.app.get<Queue>(getQueueToken(EMAIL_QUEUE));
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await resetRedisState();
    transport.clear();
    summarize.mockReset();
  });

  afterAll(async () => {
    await t.close();
  });

  /** A user in `timezone` with digest on and one merged PR in the week of 2026-11-16. */
  async function digestUser(timezone: string, digestEnabled = true) {
    const user = await f.user({ settings: { create: { timezone, digestEnabled } } });
    const gh = await f.integration(user.id, { externalAccountId: `node-${user.id}` });
    await f.pullRequest(user.id, gh.id, {
      title: 'Speed up <invoice> export',
      createdAtRemote: new Date('2026-11-17T09:00:00Z'),
      mergedAt: new Date('2026-11-18T12:00:00Z'),
      additions: 120,
      deletions: 10,
    });
    return user;
  }

  it('uses the in-memory transport in tests (never a provider)', () => {
    expect(transport).toBeInstanceOf(MemoryEmailTransport);
  });

  describe('fan-out (fake clock)', () => {
    it('queues users whose local Monday 09:00 has come; Auckland before Los Angeles; skips opted-out and delivered', async () => {
      const auckland = await digestUser('Pacific/Auckland');
      const la = await digestUser('America/Los_Angeles');
      await digestUser('Europe/London', false); // opted out
      const scheduler = new DigestScheduler(
        queue as never,
        t.prisma,
        t.app.get<ConfigService<Env, true>>(ConfigService),
      );

      // Mon 23 Nov 09:00 in Auckland = Sun 22 Nov 12:00 in Los Angeles.
      expect(await scheduler.fanout(new Date('2026-11-22T20:00:00Z'))).toEqual({
        checked: 2,
        queued: 1,
      });
      expect(await queue.getJob(digestJobId(auckland.id, '2026-11-16'))).toBeTruthy();
      expect(await queue.getJob(digestJobId(la.id, '2026-11-16'))).toBeFalsy();

      // A later fan-out the same day re-adds the same job id (BullMQ dedupes) — still one job.
      await scheduler.fanout(new Date('2026-11-22T22:00:00Z'));
      expect((await queue.getJobs(['waiting', 'delayed'])).length).toBe(1);

      // LA's Monday 09:00 (17:00Z Monday). Auckland's delivered row prevents a re-queue.
      await t.prisma.digestDelivery.create({
        data: { userId: auckland.id, weekStart: new Date('2026-11-16T00:00:00Z'), status: 'SENT' },
      });
      await queue.obliterate({ force: true });
      expect(await scheduler.fanout(new Date('2026-11-23T17:00:00Z'))).toEqual({
        checked: 2,
        queued: 1,
      });
      expect(await queue.getJob(digestJobId(la.id, '2026-11-16'))).toBeTruthy();
    });
  });

  describe('delivery', () => {
    it('sends once per user and week with engine numbers, notable PRs, suggestions and a signed unsubscribe link', async () => {
      const user = await digestUser('Europe/London');
      const now = new Date('2026-11-23T09:05:00Z');
      expect(await service().deliver({ userId: user.id, weekStart: '2026-11-16' }, now)).toBe(
        'sent',
      );
      expect(await service().deliver({ userId: user.id, weekStart: '2026-11-16' }, now)).toBe(
        'already_sent',
      );
      expect(transport.sent).toHaveLength(1);
      const mail = transport.sent[0];
      expect(mail?.to).toBe(user.email);
      expect(mail?.subject).toBe('Your week: Nov 16 – Nov 22');
      expect(mail?.text).toContain('PRs merged: 1');
      expect(mail?.html).toContain('Speed up &lt;invoice&gt; export');
      expect(mail?.html).not.toContain('<invoice>');
      expect(mail?.text).toContain('Worth capturing:');
      expect(mail?.text).toMatch(/\/activity\?item=pr_merged%3Ac/);
      expect(mail?.headers?.['List-Unsubscribe']).toMatch(
        /^<http:\/\/localhost:3000\/unsubscribe\?token=/,
      );
      const row = await t.prisma.digestDelivery.findFirstOrThrow({ where: { userId: user.id } });
      expect(row).toMatchObject({ status: 'SENT', error: null });

      // The unsubscribe link in the email works without signing in.
      const token = decodeURIComponent(/token=([^\s"&]+)/.exec(mail?.text ?? '')?.[1] ?? '');
      await request(server()).post('/api/notifications/unsubscribe').send({ token }).expect(200);
      expect(
        (await t.prisma.userSettings.findUniqueOrThrow({ where: { userId: user.id } }))
          .digestEnabled,
      ).toBe(false);
    });

    it('respects opt-out at send time, skips empty weeks, records failures and retries', async () => {
      const off = await digestUser('UTC', false);
      expect(await service().deliver({ userId: off.id, weekStart: '2026-11-16' })).toBe(
        'opted_out',
      );
      expect(await t.prisma.digestDelivery.count()).toBe(0);

      const quiet = await f.user({
        settings: { create: { timezone: 'UTC', digestEnabled: true } },
      });
      expect(await service().deliver({ userId: quiet.id, weekStart: '2026-11-16' })).toBe(
        'skipped_empty',
      );
      expect(
        await t.prisma.digestDelivery.findFirstOrThrow({ where: { userId: quiet.id } }),
      ).toMatchObject({
        status: 'SKIPPED',
        error: 'no_activity',
      });

      const flaky = await digestUser('UTC');
      transport.failNext = 1;
      await expect(
        service().deliver({ userId: flaky.id, weekStart: '2026-11-16' }),
      ).rejects.toThrow('simulated failure');
      expect(
        await t.prisma.digestDelivery.findFirstOrThrow({ where: { userId: flaky.id } }),
      ).toMatchObject({ status: 'FAILED' });
      expect(await service().deliver({ userId: flaky.id, weekStart: '2026-11-16' })).toBe('sent');
      expect(transport.sent.filter((m) => m.to === flaky.email)).toHaveLength(1);
      expect(
        await service().deliver({ userId: 'cmzzzzzzzzzzzzzzzzzzzzzzz', weekStart: '2026-11-16' }),
      ).toBe('user_missing');
    });

    it('adds the optional AI summary (escaped) and still sends when it fails', async () => {
      const user = await digestUser('UTC');
      summarize.mockResolvedValue({
        documentId: 'cm1',
        cached: false,
        content: {
          summary: { id: 's1', text: 'Busy week <script>x</script>', citations: [] },
          highlights: [{ id: 'h1', text: 'Shipped exports', citations: [] }],
        },
      });
      await service(true).deliver({ userId: user.id, weekStart: '2026-11-16' });
      expect(summarize).toHaveBeenCalledWith(user.id, '2026-11-16');
      expect(transport.sent[0]?.html).toContain('Busy week &lt;script&gt;x&lt;/script&gt;');
      expect(transport.sent[0]?.text).toContain('- Shipped exports');

      const other = await digestUser('UTC');
      summarize.mockRejectedValue(new Error('boom'));
      expect(await service(true).deliver({ userId: other.id, weekStart: '2026-11-16' })).toBe(
        'sent',
      );
    });
  });

  describe('POST /notifications/unsubscribe (public)', () => {
    const tokenFor = (userId: string, list: 'digest' | 'all', ttlDays = 60, now = new Date()) =>
      createUnsubscribeToken(TEST_SECRETS.UNSUBSCRIBE_TOKEN_SECRET, { userId, list }, ttlDays, now);

    it('works without login, is idempotent on replay, and "all" turns every email off', async () => {
      const user = await f.user({
        settings: {
          create: { digestEnabled: true, notifySyncFailures: true, notifyDocumentReady: true },
        },
      });
      const token = tokenFor(user.id, 'digest');
      const res = await request(server())
        .post('/api/notifications/unsubscribe')
        .send({ token })
        .expect(200);
      expect(res.body.data).toEqual({ unsubscribed: true, list: 'digest' });
      await request(server()).post('/api/notifications/unsubscribe').send({ token }).expect(200);
      expect(
        await t.prisma.userSettings.findUniqueOrThrow({ where: { userId: user.id } }),
      ).toMatchObject({
        digestEnabled: false,
        notifySyncFailures: true,
      });
      await request(server())
        .post('/api/notifications/unsubscribe')
        .send({ token: tokenFor(user.id, 'all') })
        .expect(200);
      expect(
        await t.prisma.userSettings.findUniqueOrThrow({ where: { userId: user.id } }),
      ).toMatchObject({
        digestEnabled: false,
        notifySyncFailures: false,
        notifyDocumentReady: false,
      });
    });

    it('rejects expired, forged, tampered, unknown-user and malformed tokens with 400', async () => {
      const user = await f.user({ settings: { create: { digestEnabled: true } } });
      const expired = tokenFor(user.id, 'digest', 1, new Date(Date.now() - 2 * 86_400_000));
      const res = await request(server())
        .post('/api/notifications/unsubscribe')
        .send({ token: expired })
        .expect(400);
      expect(res.body.error).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: expect.objectContaining({ reason: 'expired' }),
      });

      const forged = createUnsubscribeToken(
        'attacker-secret-0123456789-abcdefghijkl',
        { userId: user.id, list: 'all' },
        60,
      );
      const valid = tokenFor(user.id, 'digest');
      const tampered = `${Buffer.from(JSON.stringify({ u: user.id, l: 'all', e: 4102444800 })).toString('base64url')}.${valid.split('.')[1] ?? ''}`;
      for (const token of [forged, tampered, tokenFor('cmzzzzzzzzzzzzzzzzzzzzzzz', 'digest')]) {
        const r = await request(server())
          .post('/api/notifications/unsubscribe')
          .send({ token })
          .expect(400);
        expect(r.body.error.details.reason).toBe('invalid');
      }
      await request(server())
        .post('/api/notifications/unsubscribe')
        .send({ token: 'nope' })
        .expect(400);
      await request(server()).post('/api/notifications/unsubscribe').send({}).expect(400);
      expect(
        (await t.prisma.userSettings.findUniqueOrThrow({ where: { userId: user.id } }))
          .digestEnabled,
      ).toBe(true);
    });

    it('is rate limited per IP (public class) and carries rate-limit headers', async () => {
      const res = await request(server())
        .post('/api/notifications/unsubscribe')
        .send({ token: 'a.b.c' });
      expect(res.headers['ratelimit-limit']).toBe('60');
    });
  });

  describe('POST /notifications/digest/preview', () => {
    it('requires auth and renders last complete week without sending', async () => {
      await request(server()).post('/api/notifications/digest/preview').expect(401);
      const user = await f.user({ settings: { create: { timezone: 'UTC' } } });
      const res = await request(server())
        .post('/api/notifications/digest/preview')
        .set('authorization', bearer(user.id))
        .expect(200);
      expect(res.body.data.subject).toMatch(/^Your week: /);
      expect(res.body.data.html).toContain('<!doctype html>');
      expect(res.body.data.text).toContain('Unsubscribe (no sign-in needed)');
      expect(res.body.data.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(transport.sent).toHaveLength(0);
      expect(await t.prisma.digestDelivery.count()).toBe(0);
    });
  });
});
