import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';

import { ActivityModule } from './activity/activity.module';
import { AIModule } from './ai/ai.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { DocumentsModule } from './documents/documents.module';
import { GenerateModule } from './generate/generate.module';
import { GitHubModule } from './github/github.module';
import { HealthModule } from './health/health.module';
import { infrastructureImports } from './infrastructure';
import { IntegrationsModule } from './integrations/integrations.module';
import { MeModule } from './me/me.module';
import { SyncWorkerModule } from './sync/sync-worker.module';
import { SyncModule } from './sync/sync.module';
import { RateLimitModule, rateLimitGuardProvider } from './throttle/rate-limit';

import type { LoggingOptions } from './logging/logger';

export interface AppModuleOptions {
  /** Register BullMQ queue processors in this process (RUN_WORKER_IN_API). */
  runWorker: boolean;
  /** Test hook for capturing structured logs. */
  logging?: LoggingOptions;
}

@Module({})
export class AppModule {
  static register(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ...infrastructureImports(options.logging),
        DiscoveryModule,
        AuthModule,
        RateLimitModule,
        HealthModule,
        MeModule,
        IntegrationsModule,
        SyncModule,
        ...(options.runWorker ? [SyncWorkerModule] : []),
        ActivityModule,
        GenerateModule,
        DocumentsModule,
        AIModule,
        GitHubModule,
      ],
      // Guard order matters: authentication first, so the rate limiter can key on the user.
      providers: [{ provide: APP_GUARD, useExisting: AuthGuard }, rateLimitGuardProvider],
    };
  }
}
