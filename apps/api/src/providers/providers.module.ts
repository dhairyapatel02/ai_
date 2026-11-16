import { Module } from '@nestjs/common';

import { GitHubAppAuth } from './github/github-app-auth';
import { GitHubProvider } from './github/github.provider';

/** DI token for the `ActivityProvider` the sync engine uses (GitHub in v2.0). */
export const ACTIVITY_PROVIDER = Symbol('ACTIVITY_PROVIDER');

@Module({
  providers: [
    GitHubAppAuth,
    GitHubProvider,
    { provide: ACTIVITY_PROVIDER, useExisting: GitHubProvider },
  ],
  exports: [ACTIVITY_PROVIDER, GitHubProvider, GitHubAppAuth],
})
export class ProvidersModule {}
