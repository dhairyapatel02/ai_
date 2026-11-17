import { Module } from '@nestjs/common';

import { MetricsScheduler } from '../metrics/metrics-scheduler.service';
import { MetricsProcessor } from '../metrics/metrics.processor';
import { SyncCoreModule } from './sync-core.module';
import { SyncScheduler } from './sync-scheduler.service';
import { SyncProcessor } from './sync.processor';

/**
 * Queue consumers (`sync`, `metrics`) and the job schedulers (`sync.fanout`, `metrics.nightly`). Imported by the worker
 * process (`worker.ts`) and, when RUN_WORKER_IN_API=true, by the API process too.
 */
@Module({
  imports: [SyncCoreModule],
  providers: [SyncProcessor, MetricsProcessor, SyncScheduler, MetricsScheduler],
})
export class SyncWorkerModule {}
