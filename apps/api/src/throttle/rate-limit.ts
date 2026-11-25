import { type ExecutionContext, Inject, Injectable, Module, SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerModule,
  type ThrottlerModuleOptions,
  type ThrottlerRequest,
  type ThrottlerStorage,
  getOptionsToken,
  getStorageToken,
} from '@nestjs/throttler';
import Redis from 'ioredis';

import { type AuthenticatedRequest, IS_PUBLIC } from '../auth/auth.decorators';
import { AppException } from '../common/app-exception';
import { REDIS_CLIENT } from '../redis/redis.module';

import type { Env } from '../config/env';
import type { Response } from 'express';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Rate-limit classes (API_CONTRACT_V2 §1.1). A route belongs to exactly one class; a class is
 * enforced by one or more named windows. Keys are per user (authenticated) or per IP (public).
 * `export` covers document exports (P11); `data-export` is the contract's `/me/export` 3 / day
 * (its own window so document exports don't use it up).
 */
export const RATE_LIMIT_WINDOWS = {
  default: { ttl: MINUTE, limit: 300 },
  public: { ttl: MINUTE, limit: 60 },
  'ai-minute': { ttl: MINUTE, limit: 10 },
  'ai-day': { ttl: DAY, limit: 60 },
  sync: { ttl: HOUR, limit: 6 },
  destructive: { ttl: HOUR, limit: 5 },
  'export-hour': { ttl: HOUR, limit: 30 },
  'data-export-day': { ttl: DAY, limit: 3 },
} as const;
type WindowName = keyof typeof RATE_LIMIT_WINDOWS;

export const RATE_LIMIT_CLASSES = {
  default: ['default'],
  public: ['public'],
  ai: ['ai-minute', 'ai-day'],
  // Enforced per integration by SyncService (the integration is only known after the body is
  // resolved), not by the guard.
  sync: [],
  destructive: ['destructive'],
  export: ['export-hour'],
  'data-export': ['data-export-day'],
  // Signature-gated and answered fast; never throttled (API_CONTRACT_V2 §1.1).
  webhook: [],
  // Concurrent SSE streams per user, enforced by DocumentStreamService (a counter, not a window).
  sse: [],
} as const satisfies Record<string, readonly WindowName[]>;
export type RateLimitClass = keyof typeof RATE_LIMIT_CLASSES;

export const RATE_LIMIT_CLASS = 'devimpact:rate-limit-class';
/** Assigns a route (or controller) to a rate-limit class; defaults to `default` / `public`. */
export const RateLimit = (cls: RateLimitClass) => SetMetadata(RATE_LIMIT_CLASS, cls);

/** Fixed-window counters in Redis (shared by every API instance). */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private static readonly SCRIPT = `
    local hits = redis.call('INCR', KEYS[1])
    if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
    local ttl = redis.call('PTTL', KEYS[1])
    if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
    return { hits, ttl }`;

  constructor(private readonly redis: Redis) {}

  async increment(key: string, ttl: number, limit: number) {
    const [hits, pttl] = (await this.redis.eval(
      RedisThrottlerStorage.SCRIPT,
      1,
      `rl:${key}`,
      ttl,
    )) as [number, number];
    const seconds = Math.max(1, Math.ceil(pttl / 1000));
    const isBlocked = hits > limit;
    return {
      totalHits: hits,
      timeToExpire: seconds,
      isBlocked,
      timeToBlockExpire: isBlocked ? seconds : 0,
    };
  }
}

@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(getStorageToken()) storage: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(options, storage, reflector);
  }

  private classOf(context: ExecutionContext): RateLimitClass {
    const targets = [context.getHandler(), context.getClass()];
    const explicit = this.reflector.getAllAndOverride<RateLimitClass | undefined>(
      RATE_LIMIT_CLASS,
      targets,
    );
    if (explicit) return explicit;
    return this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, targets)
      ? 'public'
      : 'default';
  }

  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    return Promise.resolve(context.getType() !== 'http');
  }

  protected override async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    const { context, limit, ttl, throttler } = props;
    const cls = this.classOf(context);
    const windows: readonly string[] = RATE_LIMIT_CLASSES[cls];
    if (!throttler.name || !windows.includes(throttler.name)) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    const res = http.getResponse<Response>();
    const tracker = req.user ? `user:${req.user.id}` : `ip:${req.ip ?? 'unknown'}`;
    const key = `${throttler.name}:${tracker}`;
    const record = await this.storageService.increment(key, ttl, limit, ttl, throttler.name);

    // Report the class's tightest window (the first one listed).
    if (throttler.name === windows[0] || record.isBlocked) {
      res.setHeader('RateLimit-Limit', String(limit));
      res.setHeader('RateLimit-Remaining', String(Math.max(0, limit - record.totalHits)));
      res.setHeader('RateLimit-Reset', String(record.timeToExpire));
    }
    if (record.isBlocked) {
      throw new AppException('RATE_LIMITED', 'Too many requests; slow down', {
        class: cls,
        retryAfterSeconds: record.timeToBlockExpire,
      });
    }
    return true;
  }
}

/** Throttler wiring: named windows + Redis storage + the global guard (after AuthGuard). */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [REDIS_CLIENT, ConfigService],
      useFactory: (redis: Redis, config: ConfigService<Env, true>) => ({
        throttlers: Object.entries(RATE_LIMIT_WINDOWS).map(([name, w]) => ({
          name,
          ...w,
          // The `default` class limit is configurable (E2E raises it; production keeps 300/min).
          ...(name === 'default'
            ? { limit: config.get('RATE_LIMIT_DEFAULT_PER_MINUTE', { infer: true }) }
            : {}),
          // Document exports (30/hour by contract); E2E raises it like the default class.
          ...(name === 'export-hour'
            ? { limit: config.get('RATE_LIMIT_EXPORT_PER_HOUR', { infer: true }) }
            : {}),
          ...(name === 'data-export-day'
            ? { limit: config.get('RATE_LIMIT_DATA_EXPORT_PER_DAY', { infer: true }) }
            : {}),
        })),
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
  ],
})
export class RateLimitModule {}

/** Register after the AuthGuard so per-user keys can use `req.user`. */
export const rateLimitGuardProvider = { provide: APP_GUARD, useClass: RateLimitGuard };
