import {
  ActivityListQuery,
  CommitDetail,
  CommitItem,
  FeedItem,
  FeedQuery,
  IdParams,
  IssueDetail,
  IssueItem,
  IssueListQuery,
  PullRequestDetail,
  PullRequestListItem,
  PullRequestListQuery,
  ReviewItem,
  ReviewListQuery,
} from '@devimpact/shared';
import { Controller, Get } from '@nestjs/common';
import { z } from 'zod';

import { type AuthUser, CurrentUser } from '../auth/auth.decorators';
import { withMeta } from '../common/envelope.interceptor';
import { ApiDoc, ZodParams, ZodQuery } from '../common/zod-validation';
import { ActivityService } from './activity.service';

/** API_CONTRACT_V2 §11 — activity feed and explorer (F-23, F-25). */
@Controller('activity')
export class ActivityController {
  constructor(private activityService: ActivityService) {}

  @Get('feed')
  @ApiDoc({
    summary: 'Unified activity feed (commits, PRs opened/merged/closed, reviews), newest first',
    tags: ['activity'],
    response: z.array(FeedItem),
  })
  async feed(@CurrentUser() user: AuthUser, @ZodQuery(FeedQuery) query: FeedQuery) {
    const page = await this.activityService.feed(user.id, query);
    return withMeta(page.items, page.meta);
  }

  @Get('prs')
  @ApiDoc({
    summary: 'Pull requests by role (authored | reviewed)',
    tags: ['activity'],
    response: z.array(PullRequestListItem),
  })
  async getPullRequests(
    @CurrentUser() user: AuthUser,
    @ZodQuery(PullRequestListQuery) query: PullRequestListQuery,
  ) {
    const page = await this.activityService.pullRequests(user.id, query);
    return withMeta(page.items, page.meta);
  }

  @Get('prs/:id')
  @ApiDoc({ summary: 'Pull request detail', tags: ['activity'], response: PullRequestDetail })
  getPullRequest(@CurrentUser() user: AuthUser, @ZodParams(IdParams) params: { id: string }) {
    return this.activityService.pullRequest(user.id, params.id);
  }

  @Get('reviews')
  @ApiDoc({
    summary: 'Your reviews on others’ PRs',
    tags: ['activity'],
    response: z.array(ReviewItem),
  })
  async getReviews(
    @CurrentUser() user: AuthUser,
    @ZodQuery(ReviewListQuery) query: ReviewListQuery,
  ) {
    const page = await this.activityService.reviews(user.id, query);
    return withMeta(page.items, page.meta);
  }

  @Get('commits')
  @ApiDoc({
    summary: 'Default-branch commits (merge commits excluded), newest first',
    tags: ['activity'],
    response: z.array(CommitItem),
  })
  async getCommits(
    @CurrentUser() user: AuthUser,
    @ZodQuery(ActivityListQuery) query: ActivityListQuery,
  ) {
    const page = await this.activityService.commits(user.id, query);
    return withMeta(page.items, page.meta);
  }

  @Get('commits/:id')
  @ApiDoc({ summary: 'Commit detail', tags: ['activity'], response: CommitDetail })
  getCommit(@CurrentUser() user: AuthUser, @ZodParams(IdParams) params: { id: string }) {
    return this.activityService.commit(user.id, params.id);
  }

  @Get('issues')
  @ApiDoc({
    summary: 'Issues assigned to you in Jira / Linear (P13), newest update first',
    tags: ['activity'],
    response: z.array(IssueItem),
  })
  async getIssues(@CurrentUser() user: AuthUser, @ZodQuery(IssueListQuery) query: IssueListQuery) {
    const page = await this.activityService.issues(user.id, query);
    return withMeta(page.items, page.meta);
  }

  @Get('issues/:id')
  @ApiDoc({ summary: 'Issue detail', tags: ['activity'], response: IssueDetail })
  getIssue(@CurrentUser() user: AuthUser, @ZodParams(IdParams) params: { id: string }) {
    return this.activityService.issue(user.id, params.id);
  }
}
