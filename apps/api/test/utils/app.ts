import { Test, type TestingModuleBuilder } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/prisma/prisma.service';

import type { INestApplication } from '@nestjs/common';

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  close: () => Promise<void>;
}

/**
 * Boots the real HTTP app (same pipes/prefix/CORS as main.ts) against the test database.
 * Queue processors are never registered in tests. Use `override` to swap providers (e.g. the
 * Anthropic-backed AIService) — tests must never call real external APIs.
 */
export async function createTestApp(
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<TestApp> {
  let builder = Test.createTestingModule({
    imports: [AppModule.register({ runWorker: false })],
  });
  if (override) builder = override(builder);

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, { WEB_URL: 'http://localhost:3000' });
  await app.init();

  const prisma = app.get(PrismaService);
  return {
    app,
    prisma,
    close: async () => {
      await app.close();
    },
  };
}
