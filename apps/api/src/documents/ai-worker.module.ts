import { Module } from '@nestjs/common';

import { AiProcessor } from './ai.processor';
import { AiGenerationModule } from './documents.module';

/** Consumer of the `ai` queue (worker process, or the API when RUN_WORKER_IN_API=true). */
@Module({
  imports: [AiGenerationModule],
  providers: [AiProcessor],
})
export class AiWorkerModule {}
