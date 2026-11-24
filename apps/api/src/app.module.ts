import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';

import { AchievementsModule } from './achievements/achievements.module';
import { ActivityModule } from './activity/activity.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { AiWorkerModule } from './documents/ai-worker.module';
import { DocumentsModule } from './documents/documents.module';
import { EmailWorkerModule, NotificationsModule } from './email/email.module';
import { GoalsModule } from './goals/goals.module';
import { HealthModule } from './health/health.module';
import { infrastructureImports } from './infrastructure';
import { IntegrationsModule } from './integrations/integrations.module';
import { MeModule } from './me/me.module';
import { MetricsModule } from './metrics/metrics.module';
import { ReposModule } from './repos/repos.module';
import { SyncWorkerModule } from './sync/sync-worker.module';
import { SyncModule } from './sync/sync.module';
import { RateLimitModule, rateLimitGuardProvider } from './throttle/rate-limit';
import { WebhooksModule } from './webhooks/webhooks.module';

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
        ReposModule,
        WebhooksModule,
        ...(options.runWorker ? [SyncWorkerModule, AiWorkerModule, EmailWorkerModule] : []),
        ActivityModule,
        MetricsModule,
        DocumentsModule,
        AchievementsModule,
        GoalsModule,
        NotificationsModule,
      ],
      // Guard order matters: authentication first, so the rate limiter can key on the user.
      providers: [{ provide: APP_GUARD, useExisting: AuthGuard }, rateLimitGuardProvider],
    };
  }
}
