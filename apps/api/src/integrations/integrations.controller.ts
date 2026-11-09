import { Controller, Get, Post, Delete, Param, Body, Req } from '@nestjs/common';
import { Request } from 'express';

import { successResponse, errorResponse } from '../common/api-response';
import { IntegrationsService } from './integrations.service';

@Controller('integrations')
export class IntegrationsController {
  constructor(private integrationsService: IntegrationsService) {}

  @Get()
  async list(@Req() req: Request) {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return errorResponse('Not authenticated');

    const integrations = await this.integrationsService.listIntegrations(userId);
    return successResponse(integrations);
  }

  @Post('github/connect')
  connectGitHub(@Req() req: Request) {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return errorResponse('Not authenticated');

    const oauthUrl = this.integrationsService.getGitHubOAuthUrl();
    return successResponse({ url: oauthUrl });
  }

  @Post('github/callback')
  async githubCallback(@Req() req: Request, @Body() body: { code: string }) {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return errorResponse('Not authenticated');

    if (!body.code) return errorResponse('Authorization code is required');

    try {
      const integration = await this.integrationsService.exchangeGitHubCode(userId, body.code);
      return successResponse(integration);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : 'GitHub connection failed');
    }
  }

  @Delete(':id')
  async disconnect(@Req() req: Request, @Param('id') id: string) {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return errorResponse('Not authenticated');

    try {
      await this.integrationsService.disconnect(userId, id);
      return successResponse({ message: 'Integration disconnected' });
    } catch {
      return errorResponse('Integration not found');
    }
  }
}
