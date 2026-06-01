import { Injectable, Logger } from '@nestjs/common';
import { Octokit } from 'octokit';

interface GitHubCommit {
  sha: string;
  message: string;
  repo: string;
  branch: string;
  additions: number;
  deletions: number;
  timestamp: string;
}

interface GitHubPR {
  number: number;
  title: string;
  body: string | null;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  repo: string;
  mergedAt: string | null;
  createdAt: string;
}

interface GitHubReview {
  prNumber: number;
  repo: string;
  state: string;
  body: string | null;
  submittedAt: string;
}

@Injectable()
export class GitHubService {
  private readonly logger = new Logger(GitHubService.name);

  async fetchUserRepos(accessToken: string): Promise<string[]> {
    const octokit = new Octokit({ auth: accessToken });
    const repos: string[] = [];

    const iterator = octokit.paginate.iterator(octokit.rest.repos.listForAuthenticatedUser, {
      per_page: 100,
      sort: 'pushed',
      affiliation: 'owner,collaborator,organization_member',
    });

    for await (const { data } of iterator) {
      for (const repo of data) {
        repos.push(repo.full_name);
      }
    }

    return repos;
  }

  async fetchCommits(
    accessToken: string,
    repoFullName: string,
    username: string,
    since: string,
  ): Promise<GitHubCommit[]> {
    const octokit = new Octokit({ auth: accessToken });
    const [owner, repo] = repoFullName.split('/');
    const commits: GitHubCommit[] = [];

    try {
      const iterator = octokit.paginate.iterator(octokit.rest.repos.listCommits, {
        owner,
        repo,
        author: username,
        since,
        per_page: 100,
      });

      for await (const { data } of iterator) {
        for (const commit of data) {
          let additions = 0;
          let deletions = 0;

          try {
            const detail = await octokit.rest.repos.getCommit({ owner, repo, ref: commit.sha });
            additions = detail.data.stats?.additions || 0;
            deletions = detail.data.stats?.deletions || 0;
          } catch {
            // Stats not available for some commits
          }

          commits.push({
            sha: commit.sha,
            message: commit.commit.message.split('\n')[0],
            repo: repoFullName,
            branch: 'main',
            additions,
            deletions,
            timestamp: commit.commit.author?.date || new Date().toISOString(),
          });
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to fetch commits for ${repoFullName}: ${error}`);
    }

    return commits;
  }

  async fetchPullRequests(
    accessToken: string,
    repoFullName: string,
    username: string,
    since: string,
  ): Promise<GitHubPR[]> {
    const octokit = new Octokit({ auth: accessToken });
    const [owner, repo] = repoFullName.split('/');
    const prs: GitHubPR[] = [];

    try {
      const iterator = octokit.paginate.iterator(octokit.rest.pulls.list, {
        owner,
        repo,
        state: 'all',
        sort: 'updated',
        direction: 'desc',
        per_page: 100,
      });

      for await (const { data } of iterator) {
        for (const pr of data) {
          if (pr.user?.login !== username) continue;
          if (new Date(pr.created_at) < new Date(since)) continue;

          let state: 'OPEN' | 'CLOSED' | 'MERGED' = 'OPEN';
          if (pr.merged_at) state = 'MERGED';
          else if (pr.state === 'closed') state = 'CLOSED';

          prs.push({
            number: pr.number,
            title: pr.title,
            body: pr.body,
            state,
            repo: repoFullName,
            mergedAt: pr.merged_at,
            createdAt: pr.created_at,
          });
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to fetch PRs for ${repoFullName}: ${error}`);
    }

    return prs;
  }

  async fetchReviews(
    accessToken: string,
    repoFullName: string,
    username: string,
    since: string,
  ): Promise<GitHubReview[]> {
    const octokit = new Octokit({ auth: accessToken });
    const [owner, repo] = repoFullName.split('/');
    const reviews: GitHubReview[] = [];

    try {
      const prs = await octokit.paginate(octokit.rest.pulls.list, {
        owner,
        repo,
        state: 'all',
        sort: 'updated',
        direction: 'desc',
        per_page: 50,
      });

      for (const pr of prs) {
        if (new Date(pr.updated_at) < new Date(since)) break;

        try {
          const prReviews = await octokit.rest.pulls.listReviews({
            owner,
            repo,
            pull_number: pr.number,
          });

          for (const review of prReviews.data) {
            if (review.user?.login !== username) continue;

            reviews.push({
              prNumber: pr.number,
              repo: repoFullName,
              state: review.state,
              body: review.body,
              submittedAt: review.submitted_at || new Date().toISOString(),
            });
          }
        } catch {
          // Skip PRs where we can't fetch reviews
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to fetch reviews for ${repoFullName}: ${error}`);
    }

    return reviews;
  }

  async getUsername(accessToken: string): Promise<string> {
    const octokit = new Octokit({ auth: accessToken });
    const { data } = await octokit.rest.users.getAuthenticated();
    return data.login;
  }
}
