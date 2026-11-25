import { Injectable } from '@nestjs/common';
import { Provider } from '@prisma/client';

import { GitHubProvider } from './github/github.provider';
import { GitLabInstances, GitLabOAuthClient, GitLabProvider } from './gitlab/gitlab.provider';
import { JiraOAuthClient, JiraProvider } from './jira/jira.provider';
import { LinearOAuthClient, LinearProvider } from './linear/linear.provider';

import type {
  ActivityProvider,
  AnyProvider,
  IssueTrackerProvider,
  ProviderKind,
  ProviderOAuthClient,
} from '@devimpact/shared';

export const PROVIDER_ENUM: Record<ProviderKind, Provider> = {
  github: Provider.GITHUB,
  gitlab: Provider.GITLAB,
  jira: Provider.JIRA,
  linear: Provider.LINEAR,
};
export const kindOf = (provider: Provider): ProviderKind => provider.toLowerCase() as ProviderKind;

/**
 * Every data-source provider by `Provider` (P13, D-030). The sync engine, token service and
 * webhook ingress resolve the provider of an integration here; adding a provider = one entry.
 */
@Injectable()
export class ProviderRegistry {
  private readonly providers: Record<Provider, AnyProvider>;

  constructor(
    github: GitHubProvider,
    gitlab: GitLabProvider,
    jira: JiraProvider,
    linear: LinearProvider,
    private readonly gitlabOAuth: GitLabOAuthClient,
    private readonly jiraOAuth: JiraOAuthClient,
    private readonly linearOAuth: LinearOAuthClient,
    readonly gitlabInstances: GitLabInstances,
  ) {
    this.providers = {
      [Provider.GITHUB]: github,
      [Provider.GITLAB]: gitlab,
      [Provider.JIRA]: jira,
      [Provider.LINEAR]: linear,
    };
  }

  get(provider: Provider): AnyProvider {
    return this.providers[provider];
  }

  code(provider: Provider): ActivityProvider {
    const p = this.providers[provider];
    if (p.category !== 'code') throw new Error(`${provider} is not a code provider`);
    return p;
  }

  issues(provider: Provider): IssueTrackerProvider {
    const p = this.providers[provider];
    if (p.category !== 'issues') throw new Error(`${provider} is not an issue tracker`);
    return p;
  }

  oauth(kind: Exclude<ProviderKind, 'github'>): ProviderOAuthClient & { callbackUrl(): string } {
    return { gitlab: this.gitlabOAuth, jira: this.jiraOAuth, linear: this.linearOAuth }[kind];
  }
}
