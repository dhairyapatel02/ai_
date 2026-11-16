import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { bootstrapEnv } from './bootstrap-env';

async function bootstrap() {
  const env = bootstrapEnv('api');

  const app = await NestFactory.create(AppModule.register({ runWorker: env.RUN_WORKER_IN_API }), {
    bodyParser: false,
    bufferLogs: true,
  });
  app.enableShutdownHooks();
  configureApp(app, env);

  await app.listen(env.API_PORT);
  app
    .get(Logger)
    .log(`API listening on :${env.API_PORT} (queue worker in-process: ${env.RUN_WORKER_IN_API})`);
}

void bootstrap();
