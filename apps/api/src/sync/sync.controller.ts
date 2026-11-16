import { Controller, Get, HttpCode, Post } from '@nestjs/common';

import { type AuthUser, CurrentUser } from '../auth/auth.decorators';
import { ApiDoc } from '../common/zod-validation';
import { RateLimit } from '../throttle/rate-limit';
import { SyncService } from './sync.service';

/** Transitional v1 sync endpoints (P06 renames `POST /sync/trigger` → `POST /sync`). */
@Controller('sync')
export class SyncController {
  constructor(private syncService: SyncService) {}

  @Post('trigger')
  @HttpCode(202)
  @RateLimit('sync')
  @ApiDoc({
    summary: 'Queue a GitHub sync (transitional; P06: POST /sync)',
    tags: ['sync'],
    status: 202,
    rateLimit: 'sync',
  })
  triggerSync(@CurrentUser() user: AuthUser) {
    return this.syncService.triggerSync(user.id);
  }

  @Get('status')
  @ApiDoc({
    summary: 'Latest sync job state (transitional; P06 reads SyncRun from the DB)',
    tags: ['sync'],
  })
  getSyncStatus(@CurrentUser() user: AuthUser) {
    return this.syncService.getSyncStatus(user.id);
  }
}
