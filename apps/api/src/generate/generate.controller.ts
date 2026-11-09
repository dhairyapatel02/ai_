import { Controller, Get, Post, Body, Query, Req } from '@nestjs/common';
import { GenerateService } from './generate.service';
import { successResponse, errorResponse } from '../common/api-response';
import { Request } from 'express';

@Controller('generate')
export class GenerateController {
  constructor(private generateService: GenerateService) {}

  @Post('resume')
  async generateResume(
    @Req() req: Request,
    @Body() body: { dateRange: { from: string; to: string }; role: string },
  ) {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return errorResponse('Not authenticated');

    try {
      const result = await this.generateService.generateResume(userId, body.dateRange, body.role);
      return successResponse(result);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : 'Generation failed');
    }
  }

  @Post('appraisal')
  async generateAppraisal(
    @Req() req: Request,
    @Body() body: { period: string; month: number; year: number },
  ) {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return errorResponse('Not authenticated');

    try {
      const result = await this.generateService.generateAppraisal(
        userId,
        body.period,
        body.month,
        body.year,
      );
      return successResponse(result);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : 'Generation failed');
    }
  }

  @Post('promotion')
  async generatePromotion(
    @Req() req: Request,
    @Body() body: { currentRole: string; targetRole: string },
  ) {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return errorResponse('Not authenticated');

    try {
      const result = await this.generateService.generatePromotion(
        userId,
        body.currentRole,
        body.targetRole,
      );
      return successResponse(result);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : 'Generation failed');
    }
  }

  @Get('impact-score')
  async getImpactScore(
    @Req() req: Request,
    @Query('month') month: string,
    @Query('year') year: string,
    @Query('force') force: string,
  ) {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return errorResponse('Not authenticated');

    if (!month || !year) return errorResponse('month and year are required');

    try {
      const result = await this.generateService.getImpactScore(
        userId,
        parseInt(month, 10),
        parseInt(year, 10),
        force === 'true',
      );
      return successResponse(result);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : 'Score calculation failed');
    }
  }
}
