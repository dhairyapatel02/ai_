import { type DynamicModule, Module } from '@nestjs/common';

import { infrastructureImports } from './infrastructure';
import { SyncWorkerModule } from './sync/sync-worker.module';

/**
 * Everything the queue worker needs — no HTTP controllers.
 * Built lazily via `register()` so config validation runs after `.env` files are loaded.
 */
@Module({})
export class WorkerModule {
  static register(): DynamicModule {
    return { module: WorkerModule, imports: [...infrastructureImports(), SyncWorkerModule] };
  }
}
