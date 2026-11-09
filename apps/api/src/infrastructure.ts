import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { validateEnv, type Env } from './config/env';
import { redisOptionsFromUrl } from './config/redis';
import { PrismaModule } from './prisma/prisma.module';

/**
 * Modules shared by the HTTP API (`main.ts`) and the queue worker (`worker.ts`):
 * validated config, the BullMQ Redis connection and Prisma.
 */
export function infrastructureImports() {
  return [
    ConfigModule.forRoot({
      isGlobal: true,
      // `.env` files are loaded by `loadEnvFiles()` before bootstrap (see config/load-env.ts).
      ignoreEnvFile: true,
      validate: validateEnv,
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: redisOptionsFromUrl(config.get('REDIS_URL', { infer: true })),
      }),
    }),
    PrismaModule,
  ];
}
