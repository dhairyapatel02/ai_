import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { bootstrapEnv } from './bootstrap-env';

async function bootstrap() {
  const env = bootstrapEnv('api');

  const app = await NestFactory.create(AppModule.register({ runWorker: env.RUN_WORKER_IN_API }));
  app.enableShutdownHooks();

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

  app.setGlobalPrefix('api');

  await app.listen(env.API_PORT);
  console.log(
    `API running on http://localhost:${env.API_PORT} (queue worker in-process: ${env.RUN_WORKER_IN_API})`,
  );
}

void bootstrap();
