import { type INestApplication, ValidationPipe } from '@nestjs/common';

import { EmptyBodyInterceptor } from './common/empty-body.interceptor';

import type { Env } from './config/env';

/** HTTP configuration shared by `main.ts` and the integration-test app (`test/utils/app.ts`). */
export function configureApp(app: INestApplication, env: Pick<Env, 'WEB_URL'>): void {
  app.enableCors({
    origin: env.WEB_URL,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalInterceptors(new EmptyBodyInterceptor());

  app.setGlobalPrefix('api');
}
