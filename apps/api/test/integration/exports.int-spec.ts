import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { unzipSync, strFromU8 } from 'fflate';
import request from 'supertest';

import { seedOctoberActivity, waitForDocument } from '../utils/ai-fixtures';
import { startAiWorker } from '../utils/ai-worker';
import { createTestApp, type TestApp } from '../utils/app';
import { bearer } from '../utils/auth';
import { resetDatabase, resetRedisState } from '../utils/db';
import { buildFactories, type Factories } from '../utils/factories';
import { autoReply, startFakeAnthropic, type FakeAnthropic } from '../utils/fake-anthropic';

/** PDF text via pdfjs-dist in a child process (ESM-only; Jest runs CommonJS). */
function pdfText(buffer: Buffer): { pages: number; text: string } {
  const out = execFileSync(process.execPath, [join(__dirname, '../utils/pdf-text.mjs')], {
    input: buffer,
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(out.toString('utf8')) as { pages: number; text: string };
}

function docxText(buffer: Buffer): string {
  const files = unzipSync(new Uint8Array(buffer));
  const xml = files['word/document.xml'];
  if (!xml) throw new Error('word/document.xml missing');
  return strFromU8(xml)
    .replace(/<w:tab\/>/g, ' ')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => {
    cb(null, Buffer.concat(chunks));
  });
};

/** `GET /documents/:id/export` (ADR-0012, API_CONTRACT_V2 §13.2). */
describe('Document exports (integration)', () => {
  let t: TestApp;
  let f: Factories;
  let fake: FakeAnthropic;
  let userId: string;
  let as: string;
  let appraisalId: string;

  const server = () => t.app.getHttpServer();
  const exportReq = (id: string, query: string, auth = as) =>
    request(server())
      .get(`/api/documents/${id}/export?${query}`)
      .set('authorization', auth)
      .buffer(true)
      .parse(binary);

  beforeAll(async () => {
    fake = await startFakeAnthropic(autoReply);
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.ANTHROPIC_BASE_URL = fake.url;
    t = await createTestApp();
    f = buildFactories(t.prisma);
    await resetDatabase(t.prisma);
    await resetRedisState();
    const user = await f.user();
    userId = user.id;
    as = bearer(user.id);
    await seedOctoberActivity(f, userId);
    const worker = await startAiWorker(t.app);
    const created = await request(server())
      .post('/api/documents')
      .set('authorization', as)
      .send({ type: 'appraisal', period: 'month:2026-10' })
      .expect(201);
    appraisalId = created.body.data.document.id as string;
    await waitForDocument(t, appraisalId, as);
    await worker.close();
  }, 60_000);

  beforeEach(async () => {
    await resetRedisState();
  });

  afterAll(async () => {
    await t.close();
    await fake.close();
    delete process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:9';
  });

  it('PDF: magic bytes, safe filename, headers, key sections and evidence in the text', async () => {
    const res = await exportReq(appraisalId, 'format=pdf').expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="appraisal-2026-10-v1.pdf"',
    );
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['ratelimit-limit']).toBe('30');
    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const { pages, text } = pdfText(body);
    expect(pages).toBeGreaterThanOrEqual(1);
    for (const heading of ['Executive summary', 'Key contributions', 'Metrics', 'Evidence']) {
      expect(text).toContain(heading);
    }
    expect(text).toContain('Calculated by DevImpact');
    expect(text).toContain('PRs merged');
    expect(text).toMatch(/PR-acme\/api#\d+/);
  });

  it('DOCX: ZIP with word/document.xml and the same sections', async () => {
    const res = await exportReq(appraisalId, 'format=docx').expect(200);
    expect(res.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(res.headers['content-disposition']).toContain('appraisal-2026-10-v1.docx');
    const body = res.body as Buffer;
    expect(body.subarray(0, 2).toString('latin1')).toBe('PK');
    const text = docxText(body);
    for (const heading of ['Executive summary', 'Key contributions', 'Metrics', 'Evidence']) {
      expect(text).toContain(heading);
    }
    expect(text).toMatch(/PR-acme\/api#\d+/);
  });

  it('Markdown and plain text carry footnotes; resume omits citations unless asked', async () => {
    const md = await exportReq(appraisalId, 'format=md').expect(200);
    expect(md.headers['content-type']).toBe('text/markdown; charset=utf-8');
    const text = (md.body as Buffer).toString('utf8');
    expect(text).toMatch(/^# Appraisal · October 2026\n/);
    expect(text).toContain('## Key contributions');
    expect(text).toMatch(/\[\^1\]: `PR-acme\/api#\d+`/);
    const txt = await exportReq(appraisalId, 'format=txt').expect(200);
    expect((txt.body as Buffer).toString('utf8')).toContain('EVIDENCE\n[1] PR-acme/api#');

    const resume = await f.document(
      userId,
      {
        title: 'Resume · backend · October 2026',
        options: { type: 'resume', period: 'month:2026-10', role: 'backend' },
        timezone: 'America/New_York',
        promptId: 'resume',
        promptVersion: 1,
      },
      {
        format: 'bullets',
        summary: { id: 's1', text: 'Backend engineer.', citations: ['PR-acme/api#1'] },
        bullets: [
          {
            id: 'b1',
            text: 'Shipped [x](javascript:1)',
            citations: ['PR-acme/api#1'],
            theme: 'Delivery',
          },
        ],
      },
    );
    const plain = await exportReq(resume.id, 'format=md').expect(200);
    const resumeMd = (plain.body as Buffer).toString('utf8');
    expect(plain.headers['content-disposition']).toContain('resume-2026-10-v1.md');
    expect(resumeMd).not.toContain('[^1]');
    expect(resumeMd).toContain('Shipped \\[x\\](javascript:1)');
    const cited = await exportReq(resume.id, 'format=md&citations=true').expect(200);
    expect((cited.body as Buffer).toString('utf8')).toContain('[^1]: `PR-acme/api#1`');
    // Letter paper for time zones in the Americas.
    const pdf = await exportReq(resume.id, 'format=pdf').expect(200);
    expect((pdf.body as Buffer).toString('latin1')).toMatch(/\/MediaBox \[0 0 612 792\]/);
  });

  it('exports a specific version, 404 for unknown versions and other users, 400 bad format', async () => {
    // A second version (user edit) changes the summary text.
    const detail = await request(server())
      .get(`/api/documents/${appraisalId}`)
      .set('authorization', as)
      .expect(200);
    const content = detail.body.data.version.content;
    content.sections.executiveSummary.text = 'Edited summary for version two.';
    await request(server())
      .patch(`/api/documents/${appraisalId}`)
      .set('authorization', as)
      .send({ baseVersion: 1, content })
      .expect(200);
    const v2 = await exportReq(appraisalId, 'format=txt').expect(200);
    expect(v2.headers['content-disposition']).toContain('appraisal-2026-10-v2.txt');
    expect((v2.body as Buffer).toString('utf8')).toContain('Edited summary for version two.');
    const v1 = await exportReq(appraisalId, 'format=txt&version=1').expect(200);
    expect(v1.headers['content-disposition']).toContain('-v1.txt');
    expect((v1.body as Buffer).toString('utf8')).not.toContain('Edited summary');

    await exportReq(appraisalId, 'format=txt&version=9').expect(404);
    const other = await f.user();
    const foreign = await exportReq(appraisalId, 'format=pdf', bearer(other.id)).expect(404);
    expect(JSON.parse((foreign.body as Buffer).toString('utf8')).error.code).toBe('NOT_FOUND');
    await exportReq(appraisalId, 'format=html').expect(400);
    await exportReq(appraisalId, 'format=pdf&extra=1').expect(400);
    await request(server()).get(`/api/documents/${appraisalId}/export?format=md`).expect(401);
  });

  it('legacy imports export as readable text; documents without content are 409', async () => {
    const legacy = await f.document(
      userId,
      { title: 'Appraisal (imported)', type: 'APPRAISAL' },
      {
        legacy: true,
        raw: { executiveSummary: 'Delivered the roadmap.', metrics: { prCount: 66 } },
      },
    );
    const res = await exportReq(legacy.id, 'format=md').expect(200);
    expect(res.headers['content-disposition']).toContain('appraisal-undated-v1.md');
    const text = (res.body as Buffer).toString('utf8');
    expect(text).toContain('Imported from DevImpact v0.1');
    expect(text).toContain('## Executive summary');
    expect(text).toContain('| Pr count | 66 |');
    expect(text).not.toContain('{');

    const pending = await t.prisma.generatedDocument.create({
      data: {
        userId,
        type: 'APPRAISAL',
        title: 'Appraisal · pending',
        status: 'PENDING',
        currentVersion: 0,
        options: { type: 'appraisal', period: 'month:2026-10' },
        promptId: 'appraisal',
        promptVersion: 1,
        model: 'claude-opus-5-5',
        inputHash: 'pending-hash',
      },
    });
    const busy = await exportReq(pending.id, 'format=pdf').expect(409);
    expect(JSON.parse((busy.body as Buffer).toString('utf8')).error.code).toBe(
      'GENERATION_IN_PROGRESS',
    );
    await t.prisma.generatedDocument.update({
      where: { id: pending.id },
      data: { status: 'FAILED' },
    });
    const empty = await exportReq(pending.id, 'format=pdf').expect(409);
    expect(JSON.parse((empty.body as Buffer).toString('utf8')).error).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'not_ready' },
    });
  });

  it('the export class allows 30 per hour per user', async () => {
    const legacy = await f.document(userId, { title: 'Resume (imported)' });
    for (let i = 0; i < 30; i++) await exportReq(legacy.id, 'format=txt').expect(200);
    const limited = await exportReq(legacy.id, 'format=txt').expect(429);
    expect(JSON.parse((limited.body as Buffer).toString('utf8')).error).toMatchObject({
      code: 'RATE_LIMITED',
      details: { class: 'export' },
    });
  });

  it('GET /documents?status= filters the library (Documents nav signal, GAP-13)', async () => {
    await t.prisma.generatedDocument.create({
      data: {
        userId,
        type: 'RESUME',
        title: 'Resume · streaming',
        status: 'STREAMING',
        currentVersion: 0,
        options: { type: 'resume', period: 'month:2026-10', role: 'backend' },
        promptId: 'resume',
        promptVersion: 1,
        model: 'claude-opus-5-5',
        inputHash: 'streaming-hash',
      },
    });
    const res = await request(server())
      .get('/api/documents?status=pending,streaming&limit=1')
      .set('authorization', as)
      .expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('streaming');
    expect(res.body.meta.total).toBe(1);
    await request(server()).get('/api/documents?status=bogus').set('authorization', as).expect(400);
  });
});
