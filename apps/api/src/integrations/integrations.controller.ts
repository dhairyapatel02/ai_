import {
  AddIdentityInput,
  ConnectGitHubInput,
  ConnectGitHubResult,
  ConnectProviderInput,
  ConnectProviderResult,
  DisconnectQuery,
  DisconnectResult,
  GitHubCallbackInput,
  IdentityDto,
  IdentityParams,
  IdParams,
  IntegrationDto,
  ProviderCallbackInput,
  ProviderCallbackResult,
  ProviderParams,
  UpdateIntegrationInput,
  type OAuthProviderWire,
} from '@devimpact/shared';
import { Controller, Delete, Get, HttpCode, Patch, Post, Res } from '@nestjs/common';
import { z } from 'zod';

import { type AuthUser, CurrentUser } from '../auth/auth.decorators';
import { ApiDoc, ZodBody, ZodParams, ZodQuery } from '../common/zod-validation';
import { RateLimit } from '../throttle/rate-limit';
import { GitHubAppClient } from './github-app.client';
import { IntegrationsService } from './integrations.service';
import { ProviderConnectService } from './provider-connect.service';

import type { Response } from 'express';

@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly providers: ProviderConnectService,
    private readonly github: GitHubAppClient,
  ) {}

  @Get('providers')
  @ApiDoc({
    summary: 'Data-source providers this server can connect (configured + GitLab instances)',
    tags: ['integrations'],
  })
  availability() {
    return this.providers.availability(this.github.isConfigured());
  }

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

  @Post(':provider/connect')
  @HttpCode(200)
  @ApiDoc({
    summary: 'Start the GitLab / Jira / Linear OAuth flow (PKCE where supported)',
    tags: ['integrations'],
    response: ConnectProviderResult,
  })
  connectProvider(
    @CurrentUser() user: AuthUser,
    @ZodParams(ProviderParams) params: { provider: OAuthProviderWire },
    @ZodBody(ConnectProviderInput) body: ConnectProviderInput,
  ) {
    return this.providers.connect(user.id, params.provider, body);
  }

  @Post(':provider/callback')
  @HttpCode(201)
  @ApiDoc({
    summary: 'Complete the GitLab / Jira / Linear flow (state verified, code exchanged, backfill queued)',
    tags: ['integrations'],
    status: 201,
    response: ProviderCallbackResult,
  })
  callbackProvider(
    @CurrentUser() user: AuthUser,
    @ZodParams(ProviderParams) params: { provider: OAuthProviderWire },
    @ZodBody(ProviderCallbackInput) body: ProviderCallbackInput,
  ) {
    return this.providers.callback(user.id, params.provider, body);
  }

  @Get(':id/identities')
  @ApiDoc({
    summary: 'Identities linked through this integration (provider-verified + manual emails)',
    tags: ['integrations'],
    response: z.array(IdentityDto),
  })
  identities(@CurrentUser() user: AuthUser, @ZodParams(IdParams) params: { id: string }) {
    return this.providers.listIdentities(user.id, params.id);
  }

  @Post(':id/identities')
  @HttpCode(201)
  @ApiDoc({
    summary: 'Link an extra commit email (unverified; one owner per email)',
    tags: ['integrations'],
    status: 201,
    response: IdentityDto,
  })
  addIdentity(
    @CurrentUser() user: AuthUser,
    @ZodParams(IdParams) params: { id: string },
    @ZodBody(AddIdentityInput) body: AddIdentityInput,
  ) {
    return this.providers.addIdentity(user.id, params.id, body.email);
  }

  @Delete(':id/identities/:identityId')
  @HttpCode(204)
  @ApiDoc({ summary: 'Unlink a manually added email', tags: ['integrations'], status: 204 })
  async removeIdentity(
    @CurrentUser() user: AuthUser,
    @ZodParams(IdentityParams) params: { id: string; identityId: string },
  ) {
    await this.providers.removeIdentity(user.id, params.id, params.identityId);
  }

  @Patch(':id')
  @ApiDoc({
    summary: 'Update provider settings (Jira story points field; re-reads issues)',
    tags: ['integrations'],
  })
  async update(
    @CurrentUser() user: AuthUser,
    @ZodParams(IdParams) params: { id: string },
    @ZodBody(UpdateIntegrationInput) body: UpdateIntegrationInput,
  ) {
    await this.providers.update(user.id, params.id, body);
    return this.integrations.get(user.id, params.id);
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
