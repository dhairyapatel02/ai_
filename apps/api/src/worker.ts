import { writeFileSync } from 'node:fs';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { bootstrapEnv } from './bootstrap-env';
import { WorkerModule } from './worker.module';

const HEARTBEAT_INTERVAL_MS = 10_000;

/** Standalone BullMQ worker: a Nest application context with queue processors and no HTTP. */
async function bootstrap() {
  const env = bootstrapEnv('worker');
  const logger = new Logger('Worker');

  const app = await NestFactory.createApplicationContext(WorkerModule.register());
  app.enableShutdownHooks();

  const heartbeatFile = env.WORKER_HEARTBEAT_FILE;
  if (heartbeatFile) {
    const beat = () => {
      writeFileSync(heartbeatFile, new Date().toISOString());
    };
    beat();
    setInterval(beat, HEARTBEAT_INTERVAL_MS).unref();
  }

  logger.log('Worker started; consuming queue "github-sync"');
}

void bootstrap();
