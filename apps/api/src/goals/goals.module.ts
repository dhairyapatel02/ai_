import { Module } from '@nestjs/common';

import { MetricsCoreModule } from '../metrics/metrics-core.module';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';

@Module({
  imports: [MetricsCoreModule],
  controllers: [GoalsController],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule {}
