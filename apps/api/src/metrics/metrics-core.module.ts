import { Module } from '@nestjs/common';

import { ImpactScoreService } from './impact-score.service';
import { MetricsQueueService } from './metrics-queue.service';
import { MetricsRecomputeService } from './metrics-recompute.service';
import { MetricsRepository } from './metrics.repository';
import { RollupService } from './rollup.service';

/** Metrics engine services shared by the HTTP API, the worker and producers (queues are global). */
@Module({
  providers: [
    MetricsRepository,
    MetricsQueueService,
    RollupService,
    ImpactScoreService,
    MetricsRecomputeService,
  ],
  exports: [
    MetricsRepository,
    MetricsQueueService,
    RollupService,
    ImpactScoreService,
    MetricsRecomputeService,
  ],
})
export class MetricsCoreModule {}
