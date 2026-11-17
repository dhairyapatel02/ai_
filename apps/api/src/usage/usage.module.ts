import { Module } from '@nestjs/common';

import { AiCoreModule } from '../ai/ai.module';
import { UsageService } from './usage.service';

@Module({
  imports: [AiCoreModule],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
