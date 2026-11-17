import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AI_QUEUE } from '../ai/ai.constants';
import { METRICS_QUEUE, SYNC_QUEUE } from './sync.constants';

import type { Env } from '../config/env';

const prefixed = (name: string) =>
  BullModule.registerQueueAsync({
    name,
    inject: [ConfigService],
    useFactory: (config: ConfigService<Env, true>) => ({
      prefix: config.get('QUEUE_PREFIX', { infer: true }),
    }),
  });

/** The `sync`, `metrics` and `ai` queues with the per-environment prefix (OPS-17). */
@Global()
@Module({
  imports: [prefixed(SYNC_QUEUE), prefixed(METRICS_QUEUE), prefixed(AI_QUEUE)],
  exports: [BullModule],
})
export class QueuesModule {}
