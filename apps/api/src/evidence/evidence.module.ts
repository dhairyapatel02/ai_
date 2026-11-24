import { Module } from '@nestjs/common';

import { MetricsCoreModule } from '../metrics/metrics-core.module';
import { ACHIEVEMENT_SOURCE } from './achievements';
import { EvidenceBuilder } from './evidence-builder.service';
import { PrismaAchievementSource } from './prisma-achievement-source';
import { RefResolver } from './ref-resolver.service';

/** Deterministic evidence for AI documents (ADR-0009); achievements bound to Prisma in P12. */
@Module({
  imports: [MetricsCoreModule],
  providers: [
    EvidenceBuilder,
    RefResolver,
    { provide: ACHIEVEMENT_SOURCE, useClass: PrismaAchievementSource },
  ],
  exports: [EvidenceBuilder, RefResolver],
})
export class EvidenceModule {}
