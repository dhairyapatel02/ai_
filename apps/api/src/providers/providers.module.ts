import { Module } from '@nestjs/common';

import { GitHubAppAuth } from './github/github-app-auth';
import { GitHubProvider } from './github/github.provider';
import { GitLabInstances, GitLabOAuthClient, GitLabProvider } from './gitlab/gitlab.provider';
import { JiraOAuthClient, JiraProvider } from './jira/jira.provider';
import { LinearOAuthClient, LinearProvider } from './linear/linear.provider';
import { ProviderRegistry } from './provider-registry';

/** DI token for the GitHub `ActivityProvider` (targeted GitHub webhook jobs, P06). */
export const ACTIVITY_PROVIDER = Symbol('ACTIVITY_PROVIDER');

@Module({
  providers: [
    GitHubAppAuth,
    GitHubProvider,
    { provide: ACTIVITY_PROVIDER, useExisting: GitHubProvider },
    GitLabInstances,
    GitLabOAuthClient,
    GitLabProvider,
    JiraOAuthClient,
    JiraProvider,
    LinearOAuthClient,
    LinearProvider,
    ProviderRegistry,
  ],
  exports: [ACTIVITY_PROVIDER, GitHubProvider, GitHubAppAuth, ProviderRegistry],
})
export class ProvidersModule {}
