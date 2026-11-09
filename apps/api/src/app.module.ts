import { type DynamicModule, Module } from '@nestjs/common';

import { ActivityModule } from './activity/activity.module';
import { AIModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { DocumentsModule } from './documents/documents.module';
import { GenerateModule } from './generate/generate.module';
import { GitHubModule } from './github/github.module';
import { HealthModule } from './health/health.module';
import { infrastructureImports } from './infrastructure';
import { IntegrationsModule } from './integrations/integrations.module';
import { SyncWorkerModule } from './sync/sync-worker.module';
import { SyncModule } from './sync/sync.module';

export interface AppModuleOptions {
  /** Register BullMQ queue processors in this process (RUN_WORKER_IN_API). */
  runWorker: boolean;
}

@Module({})
export class AppModule {
  static register(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ...infrastructureImports(),
        HealthModule,
        AuthModule,
        IntegrationsModule,
        SyncModule,
        ...(options.runWorker ? [SyncWorkerModule] : []),
        ActivityModule,
        GenerateModule,
        DocumentsModule,
        AIModule,
        GitHubModule,
      ],
    };
  }
}
