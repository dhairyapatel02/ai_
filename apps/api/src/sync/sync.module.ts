import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { SyncProcessor } from './sync.processor';
import { GitHubModule } from '../github/github.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'github-sync' }),
    GitHubModule,
  ],
  controllers: [SyncController],
  providers: [SyncService, SyncProcessor],
  exports: [SyncService],
})
export class SyncModule {}
