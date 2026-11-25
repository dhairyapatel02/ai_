import { Module } from '@nestjs/common';

import { ProvidersModule } from '../providers/providers.module';
import { SyncModule } from '../sync/sync.module';
import { GitHubAppClient } from './github-app.client';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { OAuthStateService } from './oauth-state.service';
import { ProviderConnectService } from './provider-connect.service';

@Module({
  imports: [SyncModule, ProvidersModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, GitHubAppClient, OAuthStateService, ProviderConnectService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
