import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { redisOptionsFromUrl } from '../config/redis';

import type { Env } from '../config/env';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    await this.redis.quit().catch(() => {
      this.redis.disconnect();
    });
  }
}

/**
 * Shared ioredis client for small, fast state: rate-limit counters and OAuth state nonces.
 * (BullMQ keeps its own connections.)
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const client = new Redis({
          ...redisOptionsFromUrl(config.get('REDIS_URL', { infer: true })),
          keyPrefix: 'devimpact:',
          maxRetriesPerRequest: 2,
        });
        // Errors surface on the commands that need Redis; don't crash on 'error' events.
        client.on('error', () => undefined);
        return client;
      },
    },
    RedisLifecycle,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
