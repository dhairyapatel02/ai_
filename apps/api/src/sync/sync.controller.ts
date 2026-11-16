import {
  IdParams,
  SyncAccepted,
  SyncRequest,
  SyncRunDto,
  SyncRunListQuery,
  SyncStatusDto,
  SyncStatusQuery,
} from '@devimpact/shared';
import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { SyncTrigger } from '@prisma/client';
import { z } from 'zod';

import { type AuthUser, CurrentUser } from '../auth/auth.decorators';
import { withMeta } from '../common/envelope.interceptor';
import { ApiDoc, ZodBody, ZodParams, ZodQuery } from '../common/zod-validation';
import { RateLimit } from '../throttle/rate-limit';
import { SyncService } from './sync.service';

/** API_CONTRACT_V2 §8. `POST /sync` replaces the v1 `POST /sync/trigger`. */
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post()
  @HttpCode(202)
  @RateLimit('sync')
  @ApiDoc({
    summary:
      'Queue a sync (409 SYNC_IN_PROGRESS / INTEGRATION_NEEDS_REAUTH; 6/hour per integration)',
    tags: ['sync'],
    status: 202,
    response: SyncAccepted,
    rateLimit: 'sync',
  })
  async requestSync(@CurrentUser() user: AuthUser, @ZodBody(SyncRequest) body: SyncRequest) {
    const syncRun = await this.sync.requestSync(user.id, {
      ...(body.integrationId ? { integrationId: body.integrationId } : {}),
      trigger: SyncTrigger.MANUAL,
    });
    return { syncRun };
  }

  @Get('status')
  @ApiDoc({
    summary: 'Sync state, current/last run and next schedule (from the database)',
    tags: ['sync'],
    response: SyncStatusDto,
  })
  status(@CurrentUser() user: AuthUser, @ZodQuery(SyncStatusQuery) query: SyncStatusQuery) {
    return this.sync.status(user.id, query.integrationId);
  }

  @Get('runs')
  @ApiDoc({
    summary: 'Sync history, newest first (cursor pagination)',
    tags: ['sync'],
    response: z.array(SyncRunDto),
  })
  async runs(@CurrentUser() user: AuthUser, @ZodQuery(SyncRunListQuery) query: SyncRunListQuery) {
    const page = await this.sync.listRuns(user.id, query);
    return withMeta(page.items, page.meta);
  }

  @Get('runs/:id')
  @ApiDoc({ summary: 'One sync run', tags: ['sync'], response: SyncRunDto })
  run(@CurrentUser() user: AuthUser, @ZodParams(IdParams) params: { id: string }) {
    return this.sync.getRun(user.id, params.id);
  }
}
