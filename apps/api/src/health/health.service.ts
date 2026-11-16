import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { redisOptionsFromUrl } from '../config/redis';
import { PrismaService } from '../prisma/prisma.service';

import type { Env } from '../config/env';

export type DependencyStatus = 'ok' | 'fail';

export interface HealthReport {
  status: 'ok' | 'degraded';
  checks: { database: DependencyStatus; redis: DependencyStatus };
}

const CHECK_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => {
        reject(new Error(`timed out after ${ms}ms`));
      }, ms).unref(),
    ),
  ]);
}

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.redis = new Redis({
      ...redisOptionsFromUrl(config.get('REDIS_URL', { infer: true })),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: CHECK_TIMEOUT_MS,
    });
    // Connection errors are reported through check(); don't crash on 'error' events.
    this.redis.on('error', () => undefined);
  }

  async check(): Promise<HealthReport> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    return {
      status: database === 'ok' && redis === 'ok' ? 'ok' : 'degraded',
      checks: { database, redis },
    };
  }

  private async checkDatabase(): Promise<DependencyStatus> {
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, CHECK_TIMEOUT_MS);
      return 'ok';
    } catch {
      return 'fail';
    }
  }

  private async checkRedis(): Promise<DependencyStatus> {
    try {
      if (this.redis.status === 'wait' || this.redis.status === 'end') {
        await withTimeout(this.redis.connect(), CHECK_TIMEOUT_MS);
      }
      const pong = await withTimeout(this.redis.ping(), CHECK_TIMEOUT_MS);
      return pong === 'PONG' ? 'ok' : 'fail';
    } catch {
      return 'fail';
    }
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }
}
