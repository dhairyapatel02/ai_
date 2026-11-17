import { Module } from '@nestjs/common';

import { CareerService } from './career.service';
import { MetricsCoreModule } from './metrics-core.module';
import { CareerController, ImpactController, MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Module({
  imports: [MetricsCoreModule],
  controllers: [MetricsController, ImpactController, CareerController],
  providers: [MetricsService, CareerService],
  exports: [MetricsService],
})
export class MetricsModule {}
