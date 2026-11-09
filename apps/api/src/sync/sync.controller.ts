import { Controller, Get, Post, Req } from '@nestjs/common';
import { Request } from 'express';

import { successResponse, errorResponse } from '../common/api-response';
import { SyncService } from './sync.service';

@Controller('sync')
export class SyncController {
  constructor(private syncService: SyncService) {}

  @Post('trigger')
  async triggerSync(@Req() req: Request) {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return errorResponse('Not authenticated');

    try {
      const result = await this.syncService.triggerSync(userId);
      return successResponse(result);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : 'Sync failed');
    }
  }

  @Get('status')
  async getSyncStatus(@Req() req: Request) {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return errorResponse('Not authenticated');

    const status = await this.syncService.getSyncStatus(userId);
    return successResponse(status);
  }
}
