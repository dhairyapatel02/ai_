import {
  ConnectGitHubInput,
  ConnectGitHubResult,
  DisconnectQuery,
  DisconnectResult,
  GitHubCallbackInput,
  IdParams,
  IntegrationDto,
} from '@devimpact/shared';
import { Controller, Delete, Get, HttpCode, Post, Res } from '@nestjs/common';
import { z } from 'zod';

import { type AuthUser, CurrentUser } from '../auth/auth.decorators';
import { ApiDoc, ZodBody, ZodParams, ZodQuery } from '../common/zod-validation';
import { RateLimit } from '../throttle/rate-limit';
import { IntegrationsService } from './integrations.service';

import type { Response } from 'express';

@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  @ApiDoc({
    summary: 'List the user’s integrations (no tokens)',
    tags: ['integrations'],
    response: z.array(IntegrationDto),
  })
  list(@CurrentUser() user: AuthUser) {
    return this.integrations.list(user.id);
  }

  @Post('github/connect')
  @HttpCode(200)
  @ApiDoc({
    summary: 'Start the GitHub App install/authorize flow',
    tags: ['integrations'],
    response: ConnectGitHubResult,
  })
  connect(@CurrentUser() user: AuthUser, @ZodBody(ConnectGitHubInput) body: ConnectGitHubInput) {
    return this.integrations.connect(user.id, body.returnTo);
  }

  @Post('github/callback')
  @ApiDoc({
    summary: 'Complete the GitHub App flow (state verified, code exchanged, backfill queued)',
    tags: ['integrations'],
    status: 201,
  })
  async callback(
    @CurrentUser() user: AuthUser,
    @ZodBody(GitHubCallbackInput) body: GitHubCallbackInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.integrations.callback(user.id, body);
    if (result.kind === 'pending') {
      res.status(200);
      return { integration: result.integration, pendingApproval: true, returnTo: result.returnTo };
    }
    res.status(201);
    return { integration: result.integration, syncRun: result.syncRun, returnTo: result.returnTo };
  }

  @Get(':id')
  @ApiDoc({ summary: 'One integration with its current sync run', tags: ['integrations'] })
  get(@CurrentUser() user: AuthUser, @ZodParams(IdParams) params: { id: string }) {
    return this.integrations.get(user.id, params.id);
  }

  @Post(':id/reconnect')
  @HttpCode(200)
  @ApiDoc({
    summary: 'Authorize again for an integration that needs reconnection',
    tags: ['integrations'],
    response: ConnectGitHubResult,
  })
  reconnect(@CurrentUser() user: AuthUser, @ZodParams(IdParams) params: { id: string }) {
    return this.integrations.reconnect(user.id, params.id);
  }

  @Delete(':id')
  @RateLimit('destructive')
  @ApiDoc({
    summary: 'Disconnect (revoke token; keep or purge synced data)',
    tags: ['integrations'],
    response: DisconnectResult,
    rateLimit: 'destructive',
  })
  disconnect(
    @CurrentUser() user: AuthUser,
    @ZodParams(IdParams) params: { id: string },
    @ZodQuery(DisconnectQuery) query: DisconnectQuery,
  ) {
    return this.integrations.disconnect(user.id, params.id, query.purgeData);
  }
}
