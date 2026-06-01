import { Module } from '@nestjs/common';
import { GenerateController } from './generate.controller';
import { GenerateService } from './generate.service';
import { AIModule } from '../ai/ai.module';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [AIModule, ActivityModule],
  controllers: [GenerateController],
  providers: [GenerateService],
})
export class GenerateModule {}
