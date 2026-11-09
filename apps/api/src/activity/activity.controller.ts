import { Controller, Get, Query, Req } from '@nestjs/common';
import { Request } from 'express';

import { successResponse, errorResponse } from '../common/api-response';
import { ActivityService } from './activity.service';

@Controller('activity')
export class ActivityController {
  constructor(private activityService: ActivityService) {}

  @Get('commits')
  async getCommits(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return errorResponse('Not authenticated');

    const parsedPage = page ? parseInt(page, 10) : 1;
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    if (isNaN(parsedPage) || isNaN(parsedLimit)) return errorResponse('Invalid page or limit');

    const result = await this.activityService.getCommits(userId, from, to, parsedPage, parsedLimit);
    return successResponse(result);
  }

  @Get('prs')
  async getPullRequests(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return errorResponse('Not authenticated');

    const parsedPage = page ? parseInt(page, 10) : 1;
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    if (isNaN(parsedPage) || isNaN(parsedLimit)) return errorResponse('Invalid page or limit');

    const result = await this.activityService.getPullRequests(
      userId,
      from,
      to,
      parsedPage,
      parsedLimit,
    );
    return successResponse(result);
  }

  @Get('summary')
  async getSummary(@Req() req: Request, @Query('from') from?: string, @Query('to') to?: string) {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return errorResponse('Not authenticated');

    const summary = await this.activityService.getSummary(userId, from, to);
    return successResponse(summary);
  }
}
