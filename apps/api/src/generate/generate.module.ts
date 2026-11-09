import { Module } from '@nestjs/common';

import { ActivityModule } from '../activity/activity.module';
import { AIModule } from '../ai/ai.module';
import { GenerateController } from './generate.controller';
import { GenerateService } from './generate.service';

@Module({
  imports: [AIModule, ActivityModule],
  controllers: [GenerateController],
  providers: [GenerateService],
})
export class GenerateModule {}
