import { Worker } from 'bullmq';

import { AI_QUEUE } from '../../src/ai/ai.constants';
import { handleAiJob } from '../../src/documents/ai.processor';
import { DocumentGenerationService } from '../../src/documents/document-generation.service';

import type { INestApplication } from '@nestjs/common';

/**
 * Consumes the test `ai` queue in-process (tests never register the app's processors), with the
 * same dispatch as `AiProcessor`.
 */
export async function startAiWorker(app: INestApplication): Promise<{ close: () => Promise<void> }> {
  const generation = app.get(DocumentGenerationService);
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const worker = new Worker(AI_QUEUE, async (job) => handleAiJob(generation, job), {
    connection: { host: url.hostname, port: Number(url.port || 6379), maxRetriesPerRequest: null },
    prefix: 'devimpact-test',
    concurrency: 4,
  });
  await worker.waitUntilReady();
  return { close: () => worker.close() };
}

/** Parses a raw SSE body into events (comments dropped). */
export function parseSse(body: string): { id?: string; event: string; data: unknown }[] {
  return body
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block && !block.startsWith(':'))
    .map((block) => {
      const lines = block.split('\n');
      const field = (name: string) =>
        lines.find((l) => l.startsWith(`${name}: `))?.slice(name.length + 2);
      const id = field('id');
      return {
        ...(id ? { id } : {}),
        event: field('event') ?? 'message',
        data: JSON.parse(field('data') ?? 'null') as unknown,
      };
    });
}
