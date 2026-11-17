import { Module } from '@nestjs/common';

import { AiClient } from './ai-client';
import { AiQueueService } from './ai-queue.service';
import { AiConfig } from './ai.config';
import { DocEventsService } from './doc-events.service';
import { StructuredGenerator } from './structured-generator';

/** AI core shared by the API and the worker (queues come from the global QueuesModule). */
@Module({
  providers: [AiConfig, AiClient, StructuredGenerator, DocEventsService, AiQueueService],
  exports: [AiConfig, AiClient, StructuredGenerator, DocEventsService, AiQueueService],
})
export class AiCoreModule {}
