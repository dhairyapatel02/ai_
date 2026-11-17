import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { AI_JOBS, AI_QUEUE, type AiGenerateJobData, type AiJobResult } from '../ai/ai.constants';
import { DocumentGenerationService } from './document-generation.service';

/** Dispatch shared by the BullMQ processor and the in-process test worker. */
export function handleAiJob(
  generation: DocumentGenerationService,
  job: Pick<Job<AiGenerateJobData>, 'name' | 'data'>,
): Promise<AiJobResult> | null {
  switch (job.name) {
    case AI_JOBS.generate:
      return generation.run(job.data, { stream: true });
    case AI_JOBS.quick:
      return generation.run(job.data, { stream: false });
    default:
      return null;
  }
}

/**
 * Consumer of the `ai` queue (worker; also the API when RUN_WORKER_IN_API=true). Concurrency
 * caps parallel Anthropic calls per process (AI_WORKER_CONCURRENCY, set on the worker at boot).
 */
@Processor(AI_QUEUE, { concurrency: Number(process.env.AI_WORKER_CONCURRENCY ?? 4) })
export class AiProcessor extends WorkerHost {
  private readonly logger = new Logger(AiProcessor.name);

  constructor(private readonly generation: DocumentGenerationService) {
    super();
  }

  async process(job: Job<AiGenerateJobData>): Promise<unknown> {
    const run = handleAiJob(this.generation, job);
    if (!run) {
      this.logger.warn({ name: job.name }, 'Unknown ai job ignored');
      return null;
    }
    return run;
  }
}
