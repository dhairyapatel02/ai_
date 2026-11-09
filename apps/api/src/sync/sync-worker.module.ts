import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { GitHubModule } from '../github/github.module';
import { SYNC_QUEUE } from './sync.constants';
import { SyncProcessor } from './sync.processor';

/**
 * Registers the BullMQ processor for the GitHub sync queue. Imported by the worker process
 * (`worker.ts`) and, when RUN_WORKER_IN_API=true, by the API process too.
 */
@Module({
  imports: [BullModule.registerQueue({ name: SYNC_QUEUE }), GitHubModule],
  providers: [SyncProcessor],
})
export class SyncWorkerModule {}
