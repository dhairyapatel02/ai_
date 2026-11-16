import { Reflector } from '@nestjs/core';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { EnvelopeInterceptor } from './common/envelope.interceptor';
import { HttpExceptionFilter, sendError } from './common/http-exception.filter';
import { REQUEST_ID_HEADER } from './common/request-id';
import { mountOpenApiDocs } from './openapi/openapi';

import type { Env } from './config/env';
import type { INestApplication } from '@nestjs/common';

/** Max JSON body (API_CONTRACT_V2 §1). Webhooks (P06) get their own raw-body parser. */
export const JSON_BODY_LIMIT = '256kb';

/**
 * HTTP configuration shared by `main.ts` and the integration-test app (`test/utils/app.ts`).
 * The app must be created with `{ bodyParser: false }` so the JSON parser below (with the size
 * limit and envelope errors) is the only one.
 */
export function configureApp(
  app: INestApplication,
  env: Pick<Env, 'WEB_ORIGINS' | 'NODE_ENV'>,
): void {
  const server = app.getHttpAdapter().getInstance() as express.Express;
  server.disable('x-powered-by');

  app.useLogger(app.get(Logger));

  // Security headers (SEC-08). The API serves JSON only, so the default CSP is fine; it also
  // covers Swagger UI (no inline scripts).
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));

  // Strict CORS allow-list; no cookies — the API authenticates with Bearer tokens only.
  app.enableCors({
    origin: env.WEB_ORIGINS,
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', REQUEST_ID_HEADER, 'Last-Event-ID'],
    exposedHeaders: [
      REQUEST_ID_HEADER,
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
      'Retry-After',
    ],
    maxAge: 600,
  });

  // JSON body parser with the 256 KB limit; parse/size errors use the error envelope.
  const json = express.json({ limit: JSON_BODY_LIMIT, strict: true });
  app.use((req: Request, res: Response, next: NextFunction) => {
    json(req, res, (err?: unknown) => {
      if (err) {
        sendError(req, res, err);
        return;
      }
      next();
    });
  });

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new EnvelopeInterceptor(app.get(Reflector)));
  app.setGlobalPrefix('api');

  if (env.NODE_ENV !== 'production') mountOpenApiDocs(app);
}
