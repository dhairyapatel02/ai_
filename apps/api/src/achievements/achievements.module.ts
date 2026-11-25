import { Module } from '@nestjs/common';

import { MetricsCoreModule } from '../metrics/metrics-core.module';
import { AchievementsController } from './achievements.controller';
import { AchievementsService } from './achievements.service';

@Module({
  imports: [MetricsCoreModule],
  controllers: [AchievementsController],
  providers: [AchievementsService],
  exports: [AchievementsService],
})
export class AchievementsModule {}
