/**
 * E2E / local fake of GitLab, Jira (Atlassian auth + API) and Linear (web + API): the in-process
 * fakes of `fake-providers.ts` served over HTTP, one port per provider host (P13). Never used in
 * production; tests never call the real providers.
 *
 *   npx tsx apps/api/test/utils/serve-fake-providers.ts 4020
 *   → GitLab :4021, Atlassian auth :4022, Atlassian API :4023, Linear web :4024, Linear API :4025
 *
 * Codes `e2e-gitlab`, `e2e-jira`, `e2e-linear` are reusable; the Jira / Linear accounts match the
 * seeded demo connections (connect = reconnect), GitLab is a different account (a new connection).
 */
import { createServer, type IncomingMessage } from 'node:http';

import {
  emptyProvidersState,
  gitlabDataset,
  installFakeProviders,
  jiraIssue,
  linearIssue,
} from './fake-providers';

const base = Number(process.argv[2] ?? 4020);
const HOSTS: [number, string][] = [
  [base + 1, 'gitlab.invalid'],
  [base + 2, 'auth.atlassian.invalid'],
  [base + 3, 'api.atlassian.invalid'],
  [base + 4, 'linear.invalid'],
  [base + 5, 'api.linear.invalid'],
];

const state = emptyProvidersState();
state.reusableCodes = true;
// Updated at server start (after the seed): reconnects resume from the seeded cursor − 1 h.
gitlabDataset(state, 'e2e-gl-token');
state.codes.set('e2e-gitlab', {
  provider: 'gitlab',
  accessToken: 'e2e-gl-token',
  refreshToken: 'e2e-gl-refresh',
});
state.jira.me.set('e2e-jira-token', {
  account_id: 'seed-atlassian-5f0c1d',
  email: 'demo@devimpact.dev',
  name: 'Dana Demo',
  nickname: 'Dana Demo',
  picture: null,
});
state.jira.sites = [
  {
    id: 'seed-cloud-acme',
    name: 'Acme',
    url: 'https://acme.atlassian.net',
    scopes: ['read:jira-work'],
  },
];
state.jira.issues = [
  jiraIssue('PAY-901', {
    accountId: 'seed-atlassian-5f0c1d',
    points: 5,
    updatedMsAgo: 0,
    siteId: 'seed-cloud-acme',
  }),
  jiraIssue('PAY-902', {
    accountId: 'seed-atlassian-5f0c1d',
    status: 'indeterminate',
    updatedMsAgo: 0,
    siteId: 'seed-cloud-acme',
  }),
];
for (const i of state.jira.issues) i.fields.summary = `E2E Jira ${i.key}`;
state.codes.set('e2e-jira', {
  provider: 'jira',
  accessToken: 'e2e-jira-token',
  refreshToken: 'e2e-jira-refresh',
});
state.linear.viewers.set('e2e-linear-token', {
  id: 'seed-linear-user-dana',
  name: 'Dana Demo',
  displayName: 'dana',
  email: 'demo@devimpact.dev',
  avatarUrl: null,
  organization: { id: 'seed-linear-org', name: 'Acme', urlKey: 'acme' },
});
state.linear.issues = [
  linearIssue('ENG-901', { assigneeId: 'seed-linear-user-dana', estimate: 3, updatedMsAgo: 0 }),
];
state.linear.issues[0].title = 'E2E Linear ENG-901';
state.codes.set('e2e-linear', {
  provider: 'linear',
  accessToken: 'e2e-linear-token',
  refreshToken: 'e2e-linear-refresh',
});

installFakeProviders(state);

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      resolve(body);
    });
  });

for (const [port, host] of HOSTS) {
  createServer((req, res) => {
    void (async () => {
      const body = req.method === 'POST' ? await read(req) : undefined;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
      const reply = await fetch(`https://${host}${req.url ?? '/'}`, {
        method: req.method,
        headers,
        body,
      });
      const out: Record<string, string> = {};
      reply.headers.forEach((v, k) => (out[k] = v));
      res.writeHead(reply.status, out);
      res.end(await reply.text());
    })();
  }).listen(port, '127.0.0.1');
}
console.log(`Fake GitLab / Jira / Linear on 127.0.0.1:${base + 1}-${base + 5}`);
