import { Module } from '@nestjs/common';

import { MetricsProcessor } from '../metrics/metrics.processor';
import { SyncCoreModule } from './sync-core.module';
import { SyncScheduler } from './sync-scheduler.service';
import { SyncProcessor } from './sync.processor';

/**
 * Queue consumers (`sync`, `metrics`) and the fan-out job scheduler. Imported by the worker
 * process (`worker.ts`) and, when RUN_WORKER_IN_API=true, by the API process too.
 */
@Module({
  imports: [SyncCoreModule],
  providers: [SyncProcessor, MetricsProcessor, SyncScheduler],
})
export class SyncWorkerModule {}
