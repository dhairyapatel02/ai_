import { Module } from '@nestjs/common';

import { SyncCoreModule } from './sync-core.module';
import { SyncController } from './sync.controller';

/** HTTP side of sync: enqueue runs and report status/history from the database. */
@Module({
  imports: [SyncCoreModule],
  controllers: [SyncController],
  exports: [SyncCoreModule],
})
export class SyncModule {}
