import type { RedisOptions } from 'ioredis';

/** Converts `REDIS_URL` into ioredis/BullMQ connection options. */
export function redisOptionsFromUrl(redisUrl: string): RedisOptions {
  const url = new URL(redisUrl);
  const db = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined;
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(db !== undefined && !Number.isNaN(db) ? { db } : {}),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
