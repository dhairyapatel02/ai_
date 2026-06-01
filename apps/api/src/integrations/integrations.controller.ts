import { Controller, Get, Post, Delete, Param, Req } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { successResponse, errorResponse } from '../common/api-response';
import { Request } from 'express';

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
  async connectGitHub(@Req() req: Request) {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return errorResponse('Not authenticated');

    const oauthUrl = this.integrationsService.getGitHubOAuthUrl();
    return successResponse({ url: oauthUrl });
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
