import { Module } from '@nestjs/common';

import { MetricsCoreModule } from '../metrics/metrics-core.module';
import { ACHIEVEMENT_SOURCE, NoAchievementSource } from './achievements';
import { EvidenceBuilder } from './evidence-builder.service';
import { RefResolver } from './ref-resolver.service';

/** Deterministic evidence for AI documents (ADR-0009). P12 rebinds ACHIEVEMENT_SOURCE. */
@Module({
  imports: [MetricsCoreModule],
  providers: [
    EvidenceBuilder,
    RefResolver,
    { provide: ACHIEVEMENT_SOURCE, useClass: NoAchievementSource },
  ],
  exports: [EvidenceBuilder, RefResolver],
})
export class EvidenceModule {}
