import { Module } from '@nestjs/common';

import { MetricsCoreModule } from '../metrics/metrics-core.module';
import { ProvidersModule } from '../providers/providers.module';
import { IntegrationTokensService } from './integration-tokens.service';
import { SyncEngine } from './sync-engine.service';
import { SyncTargetedService } from './sync-targeted.service';
import { SyncWriter } from './sync-writer';
import { SyncService } from './sync.service';

/** Services shared by the HTTP API and the worker (queues come from the global QueuesModule). */
@Module({
  imports: [ProvidersModule, MetricsCoreModule],
  providers: [SyncService, SyncEngine, SyncWriter, SyncTargetedService, IntegrationTokensService],
  exports: [
    SyncService,
    SyncEngine,
    SyncWriter,
    SyncTargetedService,
    IntegrationTokensService,
    MetricsCoreModule,
    ProvidersModule,
  ],
})
export class SyncCoreModule {}
