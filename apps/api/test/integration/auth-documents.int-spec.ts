import request from 'supertest';

import { createTestApp, type TestApp } from '../utils/app';
import { resetDatabase } from '../utils/db';
import { buildFactories, type Factories } from '../utils/factories';

describe('Auth + Documents API (integration)', () => {
  let t: TestApp;
  let f: Factories;

  beforeAll(async () => {
    t = await createTestApp();
    f = buildFactories(t.prisma);
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });

  afterAll(async () => {
    await t.close();
  });

  it('POST /api/auth/dev-login creates the default dev user once and GET /api/auth/me returns it', async () => {
    const server = t.app.getHttpServer();
    const first = await request(server).post('/api/auth/dev-login').send({}).expect(201);
    const second = await request(server).post('/api/auth/dev-login').send({}).expect(201);

    expect(first.body.data.email).toBe('dev@devimpact.ai');
    expect(second.body.data.id).toBe(first.body.data.id);

    const me = await request(server)
      .get('/api/auth/me')
      .set('x-user-id', first.body.data.id)
      .expect(200);
    expect(me.body.data).toMatchObject({ email: 'dev@devimpact.ai', integrations: [] });
  });

  it('dev-login with a non-JSON body still uses the defaults (Express 4 behaviour kept)', async () => {
    const res = await request(t.app.getHttpServer())
      .post('/api/auth/dev-login')
      .set('content-type', 'text/plain')
      .send('garbage')
      .expect(201);
    expect(res.body.data.email).toBe('dev@devimpact.ai');
  });

  it('documents are scoped to their owner', async () => {
    const owner = await f.user();
    const other = await f.user();
    const doc = await f.document(owner.id);
    const server = t.app.getHttpServer();

    const list = await request(server).get('/api/documents').set('x-user-id', owner.id).expect(200);
    expect(list.body.data.total).toBe(1);

    const foreign = await request(server)
      .get(`/api/documents/${doc.id}`)
      .set('x-user-id', other.id)
      .expect(200);
    expect(foreign.body).toEqual({ success: false, error: 'Document not found' });

    const foreignDelete = await request(server)
      .delete(`/api/documents/${doc.id}`)
      .set('x-user-id', other.id)
      .expect(200);
    expect(foreignDelete.body.success).toBe(false);
    expect(await t.prisma.generatedDocument.count()).toBe(1);

    await request(server).delete(`/api/documents/${doc.id}`).set('x-user-id', owner.id).expect(200);
    expect(await t.prisma.generatedDocument.count()).toBe(0);
  });
});
