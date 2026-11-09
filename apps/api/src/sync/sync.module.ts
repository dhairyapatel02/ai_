import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { SYNC_QUEUE } from './sync.constants';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

/** HTTP side of sync: enqueue jobs and report status. Processing lives in SyncWorkerModule. */
@Module({
  imports: [BullModule.registerQueue({ name: SYNC_QUEUE })],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
