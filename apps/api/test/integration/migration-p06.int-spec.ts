import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { Client } from 'pg';

import { buildP01Fixture } from '../fixtures/legacy/p01-fixture';

/**
 * DATA_MODEL_V2 §5 migration test: a scratch database at the v0.1 schema gets the P01 fixture,
 * then every later migration (P05-1..3, P06-1, P06-2) runs exactly as `prisma migrate deploy` would.
 */
const MIGRATIONS = path.resolve(__dirname, '../../prisma/migrations');
const NOW = '2026-11-09T12:00:00Z'; // pinned: the fixture is relative to "now"

describe('P06 legacy-data migration on the P01 fixture (integration)', () => {
  const dbName = `devimpact_migtest_${process.pid}`;
  const adminUrl = process.env.DATABASE_URL ?? '';
  let admin: Client;
  let db: Client;

  const migrations = readdirSync(MIGRATIONS)
    .filter((name) => /^\d{14}_/.test(name))
    .sort();

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(adminUrl);
    url.pathname = `/${dbName}`;
    db = new Client({ connectionString: url.toString() });
    await db.connect();
  });

  afterAll(async () => {
    await db.end();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  });

  const apply = async (name: string) =>
    db.query(readFileSync(path.join(MIGRATIONS, name, 'migration.sql'), 'utf8'));

  it('Alice’s authored PRs drop to the real count, stubs are flagged, no commit lost, reviews preserved', async () => {
    const [init, ...rest] = migrations;
    expect(init).toMatch(/_init$/);
    await apply(init);

    // ── v0.1 data: the P01 fixture plus a P02-seed-style review on another user's PR.
    const fx = buildP01Fixture(NOW);
    for (const u of fx.users)
      await db.query('INSERT INTO users (id, email, name) VALUES ($1, $2, $3)', [
        u.id,
        u.email,
        u.name,
      ]);
    for (const i of fx.integrations) {
      await db.query(
        `INSERT INTO integrations (id, "userId", provider, "accessToken", metadata, "updatedAt") VALUES ($1, $2, 'GITHUB', 'gho_legacy_plaintext', $3, now())`,
        [i.id, i.userId, JSON.stringify({ login: i.login })],
      );
    }
    for (const c of fx.commits) {
      await db.query(
        'INSERT INTO commits (id, "userId", "integrationId", sha, message, repo, branch, timestamp) VALUES ($1,$2,$3,$4,$5,$6,\'main\',$7)',
        [c.id, c.userId, c.integrationId, c.sha, c.message, c.repo, c.timestamp],
      );
    }
    for (const p of fx.pullRequests) {
      await db.query(
        'INSERT INTO pull_requests (id, "userId", "integrationId", number, title, body, state, repo, "mergedAt", timestamp) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          p.id,
          p.userId,
          p.integrationId,
          p.number,
          p.title,
          p.body,
          p.state,
          p.repo,
          p.mergedAt,
          p.timestamp,
        ],
      );
    }
    for (const r of fx.codeReviews) {
      await db.query(
        'INSERT INTO code_reviews (id, "userId", "prId", comments, approved, timestamp) VALUES ($1,$2,$3,$4,$5,$6)',
        [r.id, r.userId, r.prId, r.comments, r.approved, r.timestamp],
      );
    }
    const [alice, bob] = fx.users;
    const [aliceGh] = fx.integrations;
    const bobPr = fx.pullRequests.find((p) => p.userId === bob?.id && !p.title.startsWith('PR #'));
    await db.query(
      'INSERT INTO code_reviews (id, "userId", "prId", comments, approved, timestamp) VALUES ($1,$2,$3,2,true,now())',
      ['cxreviewcrossuser000000001', alice?.id, bobPr?.id],
    );

    const aliceSummary = fx.summary['alice@audit.local'];
    if (!aliceSummary || !alice || !aliceGh || !bob || !bobPr)
      throw new Error('fixture incomplete');
    const before = await db.query<{ n: string }>(
      'SELECT count(*) n FROM pull_requests WHERE "userId" = $1',
      [alice.id],
    );
    expect(Number(before.rows[0]?.n)).toBe(aliceSummary.authoredPRs + aliceSummary.stubPRs); // what v0.1 showed

    // ── Upgrade: P05-1..3, P06-1, P06-2.
    for (const name of rest) await apply(name);

    const q = async (sql: string, params: unknown[] = []) =>
      Number((await db.query<{ n: string }>(sql, params)).rows[0]?.n);
    const authored = await q(
      'SELECT count(*) n FROM pull_requests WHERE "userId" = $1 AND is_authored_by_user AND NOT legacy_stub',
      [alice.id],
    );
    const stubs = await q(
      'SELECT count(*) n FROM pull_requests WHERE "userId" = $1 AND legacy_stub',
      [alice.id],
    );
    expect({ authored, stubs }).toEqual({
      authored: aliceSummary.authoredPRs,
      stubs: aliceSummary.stubPRs,
    });
    console.info(
      `[P06 migration] Alice: ${authored + stubs} PRs shown by v0.1 → ${authored} authored (${stubs} stubs flagged)`,
    );
    // Stubs keep no (marker) body and never count as authored.
    expect(
      await q(
        'SELECT count(*) n FROM pull_requests WHERE legacy_stub AND (body IS NOT NULL OR is_authored_by_user)',
      ),
    ).toBe(0);

    // No commit lost; every commit has a repository and keeps its message/time.
    expect(await q('SELECT count(*) n FROM commits')).toBe(fx.commits.length);
    expect(
      await q(
        'SELECT count(*) n FROM commits c JOIN repositories r ON r.id = c.repository_id AND r.integration_id = c."integrationId"',
      ),
    ).toBe(fx.commits.length);
    const sample = fx.commits[0];
    const migrated = await db.query<{ message_headline: string; authored_at: Date }>(
      'SELECT message_headline, authored_at FROM commits WHERE sha = $1',
      [sample?.sha],
    );
    expect(migrated.rows[0]).toEqual({
      message_headline: sample?.message,
      authored_at: sample?.timestamp,
    });

    // Reviews preserved (legacy ids), each on a PR row of the reviewer.
    expect(await q('SELECT count(*) n FROM pull_request_reviews')).toBe(fx.codeReviews.length + 1);
    expect(
      await q(
        'SELECT count(*) n FROM pull_request_reviews r JOIN pull_requests p ON p.id = r.pull_request_id WHERE p."userId" <> r.user_id',
      ),
    ).toBe(0);
    expect(
      await q("SELECT count(*) n FROM pull_request_reviews WHERE external_id NOT LIKE 'legacy:%'"),
    ).toBe(0);
    // The cross-user review got a reviewer-owned, non-authored copy of Bob's PR.
    expect(
      await q(
        'SELECT count(*) n FROM pull_requests WHERE "userId" = $1 AND number = $2 AND NOT is_authored_by_user AND body IS NULL',
        [alice.id, bobPr.number],
      ),
    ).toBe(1);

    // Repositories: one per (integration, repo), legacy external ids, cuid-shaped ids.
    const repos = await db.query<{ id: string; external_id: string; full_name: string }>(
      'SELECT id, external_id, full_name FROM repositories WHERE integration_id = $1',
      [aliceGh.id],
    );
    expect(repos.rows.length).toBeGreaterThan(0);
    for (const r of repos.rows) {
      expect(r.external_id).toBe(`legacy:${r.full_name}`);
      expect(r.id).toMatch(/^c[0-9a-z]{24}$/);
    }
    // P05-3 already dropped plaintext tokens; the integration needs reconnection.
    expect(
      (await db.query('SELECT status FROM integrations WHERE id = $1', [aliceGh.id])).rows[0],
    ).toEqual({ status: 'NEEDS_REAUTH' });
    expect(
      await q(
        `SELECT count(*) n FROM information_schema.columns WHERE table_name = 'code_reviews'`,
      ),
    ).toBe(0);
  });
});
