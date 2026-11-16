import { ActivityListQuery, DateRangeQuery, PullRequestListQuery } from '@devimpact/shared';
import { Controller, Get, Header } from '@nestjs/common';

import { type AuthUser, CurrentUser } from '../auth/auth.decorators';
import { withMeta } from '../common/envelope.interceptor';
import { ApiDoc, ZodQuery } from '../common/zod-validation';
import { ActivityService } from './activity.service';

/**
 * v1 activity endpoints on v2 conventions: validated queries, cursor pagination, inclusive local
 * end dates (BUG-05). Item shapes stay v1 until P07 (API_CONTRACT_V2 §20).
 */
@Controller('activity')
export class ActivityController {
  constructor(private activityService: ActivityService) {}

  @Get('commits')
  @ApiDoc({ summary: 'Commits, newest first (cursor pagination)', tags: ['activity'] })
  async getCommits(
    @CurrentUser() user: AuthUser,
    @ZodQuery(ActivityListQuery) query: ActivityListQuery,
  ) {
    const page = await this.activityService.getCommits(user.id, query);
    return withMeta(page.items, page.meta);
  }

  @Get('prs')
  @ApiDoc({
    summary: 'Pull requests by role (authored | reviewed), newest first (cursor pagination)',
    tags: ['activity'],
  })
  async getPullRequests(
    @CurrentUser() user: AuthUser,
    @ZodQuery(PullRequestListQuery) query: PullRequestListQuery,
  ) {
    const page = await this.activityService.getPullRequests(user.id, query);
    return withMeta(page.items, page.meta);
  }

  @Get('summary')
  @Header('Deprecation', 'true')
  @ApiDoc({
    summary: 'Deprecated v1 summary (replaced by /metrics/* in P07)',
    tags: ['activity'],
    deprecated: true,
  })
  getSummary(@CurrentUser() user: AuthUser, @ZodQuery(DateRangeQuery) query: DateRangeQuery) {
    return this.activityService.getSummary(user.id, query);
  }
}
