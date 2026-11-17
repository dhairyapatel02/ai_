import { writeFileSync } from 'node:fs';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { bootstrapEnv } from './bootstrap-env';
import { WorkerModule } from './worker.module';

const HEARTBEAT_INTERVAL_MS = 10_000;

/** Standalone BullMQ worker: a Nest application context with queue processors and no HTTP. */
async function bootstrap() {
  const env = bootstrapEnv('worker');
  const app = await NestFactory.createApplicationContext(WorkerModule.register(), {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();

  const heartbeatFile = env.WORKER_HEARTBEAT_FILE;
  if (heartbeatFile) {
    const beat = () => {
      writeFileSync(heartbeatFile, new Date().toISOString());
    };
    beat();
    setInterval(beat, HEARTBEAT_INTERVAL_MS).unref();
  }

  logger.log(`Worker started; consuming queues "sync", "metrics" and "ai" (prefix ${env.QUEUE_PREFIX})`);
}

void bootstrap();
