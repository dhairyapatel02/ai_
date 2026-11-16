import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { validateEnv, type Env } from './config/env';
import { redisOptionsFromUrl } from './config/redis';
import { CryptoModule } from './crypto/crypto.module';
import { loggerModule, type LoggingOptions } from './logging/logger';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

/**
 * Modules shared by the HTTP API (`main.ts`) and the queue worker (`worker.ts`):
 * validated config, structured logging, the BullMQ Redis connection, Redis, Prisma, crypto.
 */
export function infrastructureImports(logging: LoggingOptions = {}) {
  return [
    ConfigModule.forRoot({
      isGlobal: true,
      // `.env` files are loaded by `loadEnvFiles()` before bootstrap (see config/load-env.ts).
      ignoreEnvFile: true,
      validate: validateEnv,
    }),
    loggerModule(logging),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: redisOptionsFromUrl(config.get('REDIS_URL', { infer: true })),
      }),
    }),
    RedisModule,
    PrismaModule,
    CryptoModule,
  ];
}
