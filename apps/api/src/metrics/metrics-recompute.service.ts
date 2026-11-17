import { Injectable } from '@nestjs/common';

import { MetricsQueueService } from './metrics-queue.service';
import { RollupService, type RecomputeResult } from './rollup.service';

import type { MetricsRecomputeJobData } from '../sync/sync.constants';

/** Upper bound of drain loops per job (a busy webhook stream must not pin a worker forever). */
const MAX_ROUNDS = 5;

/**
 * Consumes `metrics.recompute`: unions the job's range with the user's pending range (requests
 * debounced into this job), recomputes it, and repeats while new ranges arrived meanwhile.
 */
@Injectable()
export class MetricsRecomputeService {
  constructor(
    private readonly queue: MetricsQueueService,
    private readonly rollups: RollupService,
  ) {}

  async handle(data: MetricsRecomputeJobData, now = new Date()): Promise<RecomputeResult[]> {
    const results: RecomputeResult[] = [];
    let from = new Date(data.from);
    let to = new Date(data.to);
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const pending = await this.queue.takePending(data.userId);
      if (pending) {
        if (round === 0) {
          from = new Date(Math.min(from.getTime(), pending.from.getTime()));
          to = new Date(Math.max(to.getTime(), pending.to.getTime()));
        } else {
          ({ from, to } = pending);
        }
      } else if (round > 0) {
        break;
      }
      results.push(await this.rollups.recompute(data.userId, from, to, now));
    }
    return results;
  }
}
