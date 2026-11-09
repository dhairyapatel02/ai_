import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { bootstrapEnv } from './bootstrap-env';

async function bootstrap() {
  const env = bootstrapEnv('api');

  const app = await NestFactory.create(AppModule.register({ runWorker: env.RUN_WORKER_IN_API }));
  app.enableShutdownHooks();
  configureApp(app, env);

  await app.listen(env.API_PORT);
  console.log(
    `API running on http://localhost:${env.API_PORT} (queue worker in-process: ${env.RUN_WORKER_IN_API})`,
  );
}

void bootstrap();
