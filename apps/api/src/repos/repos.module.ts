import { Module } from '@nestjs/common';

import { SyncCoreModule } from '../sync/sync-core.module';
import { ReposController } from './repos.controller';
import { ReposService } from './repos.service';

@Module({
  imports: [SyncCoreModule],
  controllers: [ReposController],
  providers: [ReposService],
})
export class ReposModule {}
