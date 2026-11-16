import { Module } from '@nestjs/common';

import { MetricsQueueService } from '../metrics/metrics-queue.service';
import { ProvidersModule } from '../providers/providers.module';
import { IntegrationTokensService } from './integration-tokens.service';
import { SyncEngine } from './sync-engine.service';
import { SyncTargetedService } from './sync-targeted.service';
import { SyncWriter } from './sync-writer';
import { SyncService } from './sync.service';

/** Services shared by the HTTP API and the worker (queues come from the global QueuesModule). */
@Module({
  imports: [ProvidersModule],
  providers: [
    SyncService,
    SyncEngine,
    SyncWriter,
    SyncTargetedService,
    IntegrationTokensService,
    MetricsQueueService,
  ],
  exports: [
    SyncService,
    SyncEngine,
    SyncWriter,
    SyncTargetedService,
    IntegrationTokensService,
    MetricsQueueService,
    ProvidersModule,
  ],
})
export class SyncCoreModule {}
