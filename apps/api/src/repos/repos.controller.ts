import {
  IdParams,
  RepoBulkPatch,
  RepoBulkResult,
  RepoListQuery,
  RepoPatch,
  RepoPurgeResult,
  RepositoryDto,
} from '@devimpact/shared';
import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { type AuthUser, CurrentUser } from '../auth/auth.decorators';
import { withMeta } from '../common/envelope.interceptor';
import { ApiDoc, ZodBody, ZodParams, ZodQuery } from '../common/zod-validation';
import { RateLimit } from '../throttle/rate-limit';
import { ReposService } from './repos.service';

/** API_CONTRACT_V2 §7 — repository selection (F-11). */
@Controller('repos')
export class ReposController {
  constructor(private readonly repos: ReposService) {}

  @Get()
  @ApiDoc({
    summary: 'Repositories known for the user’s integrations',
    tags: ['repos'],
    response: z.array(RepositoryDto),
  })
  async list(@CurrentUser() user: AuthUser, @ZodQuery(RepoListQuery) query: RepoListQuery) {
    const page = await this.repos.list(user.id, query);
    return withMeta(page.items, page.meta);
  }

  @Patch()
  @ApiDoc({
    summary: 'Include/exclude several repositories',
    tags: ['repos'],
    response: RepoBulkResult,
  })
  bulk(@CurrentUser() user: AuthUser, @ZodBody(RepoBulkPatch) body: RepoBulkPatch) {
    return this.repos.setIncludedMany(user.id, body.ids, body.included);
  }

  @Patch(':id')
  @ApiDoc({
    summary: 'Include/exclude one repository (recomputes KPIs)',
    tags: ['repos'],
    response: RepositoryDto,
  })
  patch(
    @CurrentUser() user: AuthUser,
    @ZodParams(IdParams) params: { id: string },
    @ZodBody(RepoPatch) body: RepoPatch,
  ) {
    return this.repos.setIncluded(user.id, params.id, body.included);
  }

  @Post(':id/purge')
  @HttpCode(200)
  @RateLimit('destructive')
  @ApiDoc({
    summary: 'Delete a repository’s synced activity (repository stays, excluded)',
    tags: ['repos'],
    response: RepoPurgeResult,
    rateLimit: 'destructive',
  })
  purge(@CurrentUser() user: AuthUser, @ZodParams(IdParams) params: { id: string }) {
    return this.repos.purge(user.id, params.id);
  }
}
