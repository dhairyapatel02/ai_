import { Module } from '@nestjs/common';

import { SyncModule } from '../sync/sync.module';
import { GitHubAppClient } from './github-app.client';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { OAuthStateService } from './oauth-state.service';

@Module({
  imports: [SyncModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, GitHubAppClient, OAuthStateService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
