import { Test, type TestingModuleBuilder } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/prisma/prisma.service';
import { startJwksServer } from './auth';

import type { INestApplication } from '@nestjs/common';
import type { DestinationStream } from 'pino';

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  close: () => Promise<void>;
}

export interface TestAppOptions {
  /** Capture structured request logs (see logging.int-spec.ts). */
  logStream?: DestinationStream;
}

/**
 * Boots the real HTTP app (same middleware, guards, filters and prefix as main.ts) against the
 * test database, with a local JWKS server standing in for the web app (see `utils/auth.ts`).
 * Queue processors are never registered in tests. Use `override` to swap providers (e.g. the
 * Anthropic-backed AIService or the GitHub App client) — tests never call real external APIs.
 */
export async function createTestApp(
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
  options: TestAppOptions = {},
): Promise<TestApp> {
  const jwks = await startJwksServer();
  process.env.AUTH_JWKS_URL = jwks.url;

  let builder = Test.createTestingModule({
    imports: [
      AppModule.register({
        runWorker: false,
        ...(options.logStream ? { logging: { stream: options.logStream } } : {}),
      }),
    ],
  });
  if (override) builder = override(builder);

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ bodyParser: false, bufferLogs: true });
  configureApp(app, { WEB_ORIGINS: ['http://localhost:3000'], NODE_ENV: 'test' });
  await app.init();

  const prisma = app.get(PrismaService);
  return {
    app,
    prisma,
    close: async () => {
      await app.close();
      await jwks.close();
    },
  };
}
