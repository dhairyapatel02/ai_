/* DevImpact AI v2 prototype — deterministic seeded data + a faithful mini metrics engine.
   Formulas follow docs/v2/blueprint/KPI_METHODOLOGY.md (metrics@2.0.0, impact@2.0.0) so every number
   in the prototype is explainable. Timezone fixed to UTC for the prototype. "Today" = 2026-11-09. */
(function () {
  'use strict';
  const DAY = 864e5, HOUR = 36e5;
  const TODAY = Date.UTC(2026, 10, 9, 15, 0);
  const START = Date.UTC(2025, 9, 1);

  // ---------- seeded RNG ----------
  let seed = 2026;
  function R() {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const pick = (a) => a[Math.floor(R() * a.length)];
  function gauss() { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  const logn = (median, sigma) => median * Math.exp(sigma * gauss());
  function weighted(items) { const total = items.reduce((s, i) => s + i.w, 0); let r = R() * total; for (const i of items) { r -= i.w; if (r <= 0) return i; } return items[items.length - 1]; }

  // ---------- time helpers ----------
  const dayStart = (t) => Math.floor(t / DAY) * DAY;
  const isWeekend = (t) => { const d = new Date(t).getUTCDay(); return d === 0 || d === 6; };
  function businessHours(a, b) {
    if (b <= a) return 0; let h = 0, t = a;
    while (t < b) { const end = Math.min(dayStart(t) + DAY, b); if (!isWeekend(t)) h += end - t; t = end; }
    return h / HOUR;
  }
  function addBH(t, hours) {
    let rem = hours * HOUR;
    while (rem > 0) { if (isWeekend(t)) { t = dayStart(t) + DAY; continue; } const seg = Math.min(dayStart(t) + DAY - t, rem); t += seg; rem -= seg; }
    return t;
  }
  const AWAY = [[Date.UTC(2025, 11, 22), Date.UTC(2026, 0, 5)], [Date.UTC(2026, 7, 3), Date.UTC(2026, 7, 31)]];
  const isAway = (t) => AWAY.some(([a, b]) => t >= a && t < b);
  const iso = (t) => new Date(t).toISOString().slice(0, 10);

  // ---------- fixtures ----------
  const USER = { name: 'Priya Raman', login: 'priyar', email: 'priya@harbor.dev', initials: 'PR', timezone: 'Europe/London',
    currentRole: 'Software Engineer II', careerLevel: 'L4', targetRole: 'Senior Software Engineer', plan: 'free' };
  const REPOS = [
    { id: 'r1', name: 'harbor-io/payments-api', private: true, w: 5, area: 'payments', next: 1840, lastActivity: TODAY - 0.2 * DAY, included: true },
    { id: 'r2', name: 'harbor-io/web-checkout', private: true, w: 3, area: 'checkout', next: 2310, lastActivity: TODAY - 1.1 * DAY, included: true },
    { id: 'r3', name: 'harbor-io/ledger-service', private: true, w: 2, area: 'ledger', next: 640, lastActivity: TODAY - 3 * DAY, included: true },
    { id: 'r4', name: 'harbor-io/ui-kit', private: false, w: 1, area: 'ui', next: 412, lastActivity: TODAY - 12 * DAY, included: true },
    { id: 'r5', name: 'priyar/terraform-modules', private: false, w: 0.6, area: 'infra', next: 58, lastActivity: TODAY - 9 * DAY, included: true },
  ];
  const EXTRA_REPOS = [
    { id: 'r6', name: 'harbor-io/notifications-worker', private: true, lastActivity: TODAY - 120 * DAY, included: true },
    { id: 'r7', name: 'harbor-io/hackweek-2025', private: true, lastActivity: TODAY - 300 * DAY, included: false },
    { id: 'r8', name: 'priyar/dotfiles', private: false, lastActivity: TODAY - 200 * DAY, included: false },
    { id: 'r9', name: 'harbor-io/legacy-admin', private: true, lastActivity: TODAY - 500 * DAY, included: false, inactive: true },
  ];
  const TITLES = {
    payments: ['Add idempotency keys to refund endpoint', 'Retry Stripe webhooks with exponential backoff', 'Split payout scheduler into smaller jobs', 'Validate currency precision before capture', 'Remove deprecated v1 charge flow', 'Add tracing to settlement pipeline', 'Fix race in partial refund reconciliation', 'Cache FX rates for 60 seconds', 'Migrate payment intents to new state machine', 'Harden 3DS challenge timeout handling'],
    checkout: ['Lazy-load address autocomplete', 'Fix focus trap in payment sheet', 'Show saved cards first in wallet', 'Reduce checkout bundle by 38 kB', 'Add error states to coupon field', 'Support Apple Pay on Safari 18', 'Debounce shipping quote requests', 'Improve tax line accessibility labels'],
    ledger: ['Add double-entry invariant check', 'Backfill missing journal references', 'Partition ledger_entries by month', 'Expose balance snapshot endpoint', 'Speed up month-end close query'],
    ui: ['Add Combobox keyboard navigation', 'Fix Toast contrast in dark theme', 'Document Table density variants'],
    infra: ['Add RDS parameter group module', 'Pin AWS provider to 5.x', 'Add budget alarms module'],
  };
  const TEAMMATES = ['mkovacs', 'dlin', 'samuel-o', 'aisha-b', 'tomasz-w', 'jgarcia', 'noor-h'];
  const LABELS = ['payments', 'perf', 'bug', 'feature', 'infra', 'a11y', 'tech-debt', 'security'];

  // ---------- generate activity ----------
  const prs = [], reviewed = [], reviews = [], commits = [];
  let prSeq = 0, revSeq = 0, cSeq = 0, rpSeq = 0;
  const shortSha = () => Math.floor(R() * 0xfffffff).toString(16).padStart(7, '0');
  for (let d = START; d < dayStart(TODAY) + DAY; d += DAY) {
    if (isWeekend(d) || isAway(d)) continue;
    const progress = (d - START) / (TODAY - START);
    // authored PRs
    if (R() < 0.27 + 0.08 * progress) {
      const repo = weighted(REPOS);
      const createdAt = d + (9 + R() * 8) * HOUR;
      if (createdAt > TODAY) continue;
      const draft = R() < 0.2;
      const readyAt = draft ? addBH(createdAt, 2 + R() * 18) : createdAt;
      const unmerged = R() < 0.08;
      let mergedAt = null, closedAt = null;
      if (unmerged) { closedAt = addBH(readyAt, logn(30, 0.8)); if (closedAt > TODAY) closedAt = null; }
      else { mergedAt = addBH(readyAt, logn(24, 0.85)); if (mergedAt > TODAY) mergedAt = null; else closedAt = mergedAt; }
      let firstReviewAt = addBH(readyAt, logn(4, 0.8)); if (mergedAt && firstReviewAt > mergedAt) firstReviewAt = mergedAt - HOUR; if (firstReviewAt > TODAY) firstReviewAt = null;
      const lines = Math.round(logn(150, 0.95)) + 4;
      const additions = Math.round(lines * (0.55 + R() * 0.35));
      const reverted = mergedAt && mergedAt < TODAY - 10 * DAY && R() < 0.035 ? mergedAt + 2 * DAY : null;
      const changesRequested = R() < 0.72 ? 0 : R() < 0.8 ? 1 : 2;
      const number = repo.next++;
      const title = pick(TITLES[repo.area]);
      const labels = R() < 0.6 ? [pick(LABELS)] : R() < 0.5 ? [pick(LABELS), pick(LABELS)].filter((v, i, a) => a.indexOf(v) === i) : [];
      const pr = { id: 'pr' + ++prSeq, repo: repo.name, repoId: repo.id, number, title, createdAt, readyAt, mergedAt, closedAt, firstReviewAt,
        additions, deletions: lines - additions, lines, changedFiles: 1 + Math.floor(lines / 40), reverted, changesRequested, labels, isDraft: draft && !mergedAt && readyAt > TODAY,
        ref: `PR-${repo.name}#${number}`, url: `https://github.com/${repo.name}/pull/${number}`, approvals: 1 + (R() < 0.4 ? 1 : 0) };
      prs.push(pr);
      const k = 1 + Math.floor(R() * 5);
      for (let i = 0; i < k; i++) {
        let t = createdAt - R() * 1.5 * DAY; if (isWeekend(t)) t -= 2 * DAY;
        const sha = shortSha();
        commits.push({ id: 'c' + ++cSeq, repo: repo.name, repoId: repo.id, sha, authoredAt: t, message: i === k - 1 ? title : pick(['WIP: ', 'Refactor ', 'Test: ', 'Tidy ']) + title.toLowerCase(),
          additions: Math.round(additions / k), deletions: Math.round((lines - additions) / k), ref: `C-${repo.name}@${sha}`, url: `https://github.com/${repo.name}/commit/${sha}`, prNumber: number });
      }
    }
    if (R() < 0.07) {
      const repo = REPOS[4]; const sha = shortSha(); const t = d + (10 + R() * 7) * HOUR;
      if (t < TODAY) commits.push({ id: 'c' + ++cSeq, repo: repo.name, repoId: repo.id, sha, authoredAt: t, message: pick(TITLES.infra), additions: 20, deletions: 4, ref: `C-${repo.name}@${sha}`, url: `https://github.com/${repo.name}/commit/${sha}`, prNumber: null });
    }
    // reviews of teammates' PRs
    const nrev = (R() < 0.42 + 0.06 * progress ? 1 : 0) + (R() < 0.12 ? 1 : 0);
    for (let i = 0; i < nrev; i++) {
      const repo = weighted(REPOS.slice(0, 4));
      const requested = R() < 0.82;
      const base = d + (9 + R() * 7) * HOUR;
      const firstAt = addBH(base, logn(5, 0.9));
      if (firstAt > TODAY) continue;
      const number = repo.next++;
      const rp = { id: 'rp' + ++rpSeq, repo: repo.name, repoId: repo.id, number, title: pick(TITLES[repo.area]), author: pick(TEAMMATES),
        url: `https://github.com/${repo.name}/pull/${number}`, ref: `REV-${repo.name}#${number}` };
      reviewed.push(rp);
      const states = ['APPROVED', 'APPROVED', 'APPROVED', 'COMMENTED', 'COMMENTED', 'CHANGES_REQUESTED'];
      reviews.push({ id: 'rv' + ++revSeq, prId: rp.id, repo: repo.name, repoId: repo.id, submittedAt: firstAt, requestedAt: requested ? base : null,
        state: pick(states), comments: Math.floor(R() * 7), hasBody: R() < 0.5 });
      if (R() < 0.25) { const t2 = addBH(firstAt, 6 + R() * 20); if (t2 < TODAY) reviews.push({ id: 'rv' + ++revSeq, prId: rp.id, repo: repo.name, repoId: repo.id, submittedAt: t2, requestedAt: requested ? base : null, state: 'APPROVED', comments: Math.floor(R() * 2), hasBody: false }); }
    }
  }
  const reviewedById = Object.fromEntries(reviewed.map((r) => [r.id, r]));

  const achievements = [
    { id: 'a1', title: 'Led incident response for checkout latency regression', category: 'incident', occurredOn: '2026-09-18', description: 'Coordinated a 3-person response, rolled back the cache change and wrote the post-incident review.', impact: 'Checkout p95 back under 400 ms within 50 minutes.', evidence: [], links: [{ label: 'Incident review', url: 'https://example.com/pir-118' }], source: 'manual' },
    { id: 'a2', title: 'Mentored two new joiners on the payments domain', category: 'mentoring', occurredOn: '2026-07-01', description: 'Weekly pairing sessions and a payments onboarding guide.', impact: 'Both shipped their first production PR in week two.', evidence: [], links: [], source: 'manual' },
    { id: 'a3', title: 'Wrote RFC: idempotent webhook processing', category: 'leadership', occurredOn: '2026-05-12', description: 'Design doc adopted by payments and ledger teams.', impact: 'Duplicate refunds dropped to zero after rollout.', evidence: [], links: [{ label: 'RFC-042', url: 'https://example.com/rfc-042' }], source: 'manual' },
    { id: 'a4', title: 'Cut CI time for payments-api by 38%', category: 'delivery', occurredOn: '2026-03-20', description: 'Introduced dependency caching and test sharding.', impact: 'Median pipeline 14 → 8.7 minutes.', evidence: [], links: [], source: 'from_activity' },
    { id: 'a5', title: 'Internal talk: Postgres indexing for product engineers', category: 'learning', occurredOn: '2026-10-22', description: '45-minute session, recording shared on the wiki.', impact: '', evidence: [], links: [], source: 'manual' },
  ];
  // link achievement evidence to real PRs in the right months
  for (const a of achievements) {
    const t = Date.parse(a.occurredOn + 'T12:00:00Z');
    const near = prs.filter((p) => p.mergedAt && Math.abs(p.mergedAt - t) < 20 * DAY).slice(0, a.id === 'a5' ? 0 : 2);
    a.evidence = near.map((p) => p.id); a.ref = 'ACH-' + a.id;
  }

  // ---------- periods ----------
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MON = MONTHS.map((m) => m.slice(0, 3));
  function period(spec) {
    const [type, val] = spec.split(':');
    let s, e, label;
    if (type === 'month') { const [y, m] = val.split('-').map(Number); s = Date.UTC(y, m - 1, 1); e = Date.UTC(y, m, 1); label = `${MONTHS[m - 1]} ${y}`; }
    else if (type === 'quarter') { const y = +val.slice(0, 4), q = +val.slice(6); s = Date.UTC(y, (q - 1) * 3, 1); e = Date.UTC(y, q * 3, 1); label = `Q${q} ${y}`; }
    else if (type === 'half') { const y = +val.slice(0, 4), h = +val.slice(6); s = Date.UTC(y, (h - 1) * 6, 1); e = Date.UTC(y, h * 6, 1); label = `H${h} ${y}`; }
    else if (type === 'year') { const y = +val; s = Date.UTC(y, 0, 1); e = Date.UTC(y + 1, 0, 1); label = `${y}`; }
    else { const [a, b] = val.split('..'); s = Date.parse(a + 'T00:00:00Z'); e = Date.parse(b + 'T00:00:00Z') + DAY; label = `${fmtDate(s)} – ${fmtDate(e - DAY)}`; }
    const inProgress = e > TODAY && s <= TODAY;
    return { spec, type, start: s, endEx: e, days: Math.round((e - s) / DAY), inProgress, label, startDate: iso(s), endDate: iso(e - DAY), cutoff: Math.min(e, TODAY) };
  }
  function previous(p) {
    let spec;
    const d = new Date(p.start);
    if (p.type === 'month') { const y = d.getUTCFullYear(), m = d.getUTCMonth(); const pd = new Date(Date.UTC(y, m - 1, 1)); spec = `month:${pd.getUTCFullYear()}-${String(pd.getUTCMonth() + 1).padStart(2, '0')}`; }
    else if (p.type === 'quarter') { const y = d.getUTCFullYear(), q = Math.floor(d.getUTCMonth() / 3) + 1; spec = q === 1 ? `quarter:${y - 1}-Q4` : `quarter:${y}-Q${q - 1}`; }
    else if (p.type === 'half') { const y = d.getUTCFullYear(), h = d.getUTCMonth() < 6 ? 1 : 2; spec = h === 1 ? `half:${y - 1}-H2` : `half:${y}-H1`; }
    else if (p.type === 'year') spec = `year:${d.getUTCFullYear() - 1}`;
    else spec = `custom:${iso(p.start - p.days * DAY)}..${iso(p.start - DAY)}`;
    const prev = period(spec);
    if (p.inProgress) { const elapsed = TODAY - p.start; prev.cutoff = Math.min(prev.endEx, prev.start + elapsed); prev.sameElapsed = true; }
    return prev;
  }
  function fmtDate(t, withYear = true) { const d = new Date(t); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}${withYear ? ', ' + d.getUTCFullYear() : ''}`; }

  // ---------- metrics (KPI_METHODOLOGY §3) ----------
  const DEFS = [
    // key, label, section, unit, minN, inScore, direction, definition, formula, goodRange, caveats[], antiGaming
    ['prs_merged', 'PRs merged', 'delivery', 'count', 0, true, 'higher_is_better', 'Pull requests you authored that were merged in this period.', '|{ p ∈ AP : p.mergedAt ∈ period }|', '4–12 per 4 weeks is typical for product teams', ['Team conventions (stacked PRs, monorepo vs many repos) change counts a lot.', 'Merges done by others still count — authorship is what matters.'], 'Score saturates at 12 per 4 weeks; tiny PRs are not rewarded beyond the small-PR ratio.'],
    ['prs_opened', 'PRs opened', 'delivery', 'count', 0, false, 'neutral', 'Pull requests you opened in this period (including drafts).', '|{ p ∈ AP : p.createdAt ∈ period }|', 'Context only', ['Not scored, so opening PRs never raises the score by itself.'], null],
    ['pr_cycle_time_median_hours', 'PR cycle time (median)', 'delivery', 'hours', 3, true, 'lower_is_better', 'Typical business hours from a PR being ready for review to being merged, for your PRs merged in this period.', 'median(businessHours(readyAt(p), p.mergedAt)) for p ∈ AP merged in period', '< 24 h excellent · 24–72 h healthy · > 1 week worth a look', ["Depends heavily on reviewers' availability and team process.", 'Draft time is excluded by design.', 'Holidays are not modelled in v2.0.'], 'Only 30% of one dimension; first-pass approval and reviewer data stay visible.'],
    ['merge_rate', 'Merge rate', 'quality', 'ratio', 3, true, 'higher_is_better', 'Of your PRs that were closed in this period, the share that were merged.', 'M / (M + U), U = PRs closed unmerged in period', '80–95%', ['Exploratory or spike work legitimately lowers it.', 'The band saturates at 90%, so abandoning nothing is not required for a full score.'], null],
    ['active_weeks_ratio', 'Active weeks', 'consistency', 'ratio', 0, true, 'higher_is_better', "Share of the period's working weeks with at least one contribution.", '|active ISO weeks| / |ISO weeks with a weekday in period|', '≥ 75%', ['Holidays and leave lower it.', 'One contribution per week is enough — it rewards steadiness, not volume.'], null],
    ['small_pr_ratio', 'Small PR ratio', 'quality', 'ratio', 3, true, 'higher_is_better', 'Share of your merged PRs with 400 or fewer changed lines.', '|{ p ∈ AP_m : changedLines(p) ≤ 400 }| / |AP_m|', '≥ 70%', ['Generated files, lockfiles, migrations and renames inflate changed lines.'], 'Splitting a change into dependent PRs is genuinely good practice.'],
    ['revert_rate', 'Revert rate', 'quality', 'ratio', 3, true, 'lower_is_better', 'Share of your PRs merged in this period that were later reverted.', '|{ p ∈ AP_m : p.revertedAt ≠ null }| / |AP_m|', '< 5%', ['Reverts made with plain git revert without referencing the PR are not detected.', 'A past period can change later when a revert lands.'], null],
    ['pr_size_median_lines', 'Median PR size', 'quality', 'lines', 3, false, 'neutral', 'Typical changed lines (added + deleted) of your PRs merged in this period.', 'median(changedLines(p)) for p ∈ AP_m', 'Context only', ['Shown next to the small-PR ratio; never framed as output.'], null],
    ['first_pass_approval_rate', 'First-pass approval', 'quality', 'ratio', 3, false, 'neutral', "Share of your merged PRs approved without any 'changes requested' review.", '|{ p ∈ AP_m : changesRequested = 0 }| / |AP_m|', 'Context only', ['Strongly dependent on team review culture; not scored for that reason.'], null],
    ['prs_reviewed', 'PRs reviewed', 'collaboration', 'count', 0, true, 'higher_is_better', 'Distinct pull requests by others that you reviewed in this period.', "|{ p ∈ RP : user reviewed p in period }|", '5–15 per 4 weeks for product teams', ['Counting distinct PRs removes the inflation from replies recorded as COMMENTED reviews.'], 'Saturates at 15 per 4 weeks; rubber-stamp approvals are visible in review depth.'],
    ['review_turnaround_median_hours', 'Review turnaround (median)', 'collaboration', 'hours', 3, true, 'lower_is_better', 'Typical business hours from being asked to review to submitting your first review, for reviews submitted in this period.', 'median(businessHours(r₁.reviewRequestedAt, r₁.submittedAt))', '< 8 h excellent · < 24 h healthy', ['Reviews without a recorded request (drive-by reviews) are excluded.', 'Team requests are attributed to you if you reviewed.'], null],
    ['review_balance', 'Review balance', 'collaboration', 'ratio', 3, true, 'higher_is_better', 'How your reviewing compares with your authoring: reviews ÷ (reviews + merged PRs).', 'prs_reviewed / (prs_reviewed + prs_merged)', '40–70%', ['Score saturates at 50% — reviewing more than you author is never penalised.'], null],
    ['time_to_first_review_median_hours', 'Time to first review (as author)', 'collaboration', 'hours', 3, false, 'neutral', 'Typical business hours your PRs waited for a first review from someone else.', 'median(businessHours(readyAt(p), p.firstReviewAt))', 'Context only', ["Measures your teammates' responsiveness more than yours — never scored."], null],
    ['review_depth_median', 'Review depth (median)', 'collaboration', 'comments', 3, false, 'neutral', 'Typical number of comments you leave per PR you review.', 'median(Σ commentsCount + hasBody) per reviewed PR', 'Context only', ['More comments are not inherently better; shown for self-reflection only.'], null],
    ['repos_reviewed', 'Repositories reviewed in', 'collaboration', 'repos', 0, false, 'neutral', 'Repositories where you reviewed at least one PR in this period.', 'distinct repositoryId over PRs counted in prs_reviewed', 'Context only', [], null],
    ['repos_contributed', 'Repositories contributed to', 'ownership', 'repos', 0, true, 'higher_is_better', 'Repositories where you committed, opened or merged a PR, or reviewed in this period.', 'distinct repositoryId over commits ∪ PRs opened ∪ PRs merged ∪ reviewed PRs', '1–5 (saturates at 5)', ['Not rate-normalised: breadth over a year naturally exceeds a month.'], null],
    ['two_way_repos', 'Two-way repositories', 'ownership', 'repos', 0, true, 'higher_is_better', "Repositories where you both merged your own PRs and reviewed others' PRs in this period.", '|repos with merged AP ∩ repos with reviews|', '≥ 2 (saturates at 3)', [], null],
    ['repos_with_merged_prs', 'Repositories with merged PRs', 'ownership', 'repos', 0, false, 'neutral', 'Repositories where at least one of your PRs was merged in this period.', 'distinct repositoryId over AP_m', 'Context only', [], null],
    ['active_days', 'Active days', 'consistency', 'days', 0, false, 'neutral', 'Days in this period with at least one commit, PR opened or review.', 'distinct local dates of commits ∪ PRs opened ∪ reviews', 'Context only', ['Not scored, to avoid rewarding always-on or weekend work.'], null],
    ['commits', 'Commits', 'consistency', 'count', 0, false, 'neutral', 'Commits you authored on default branches in this period (merge commits excluded).', '|{ c ∈ CM : c.authoredAt ∈ period }|', 'Context only', ['Commit granularity is a personal style; squash-merge teams show few commits. Never scored.'], null],
    ['longest_active_week_streak', 'Longest active-week streak', 'consistency', 'weeks', 0, false, 'neutral', 'Longest run of consecutive active weeks within the period.', 'longest run of consecutive active ISO weeks', 'Milestone only', ['Shown as a milestone only; never scored.'], null],
  ].map(([key, label, section, unit, minN, inScore, direction, definition, formula, goodRange, caveats, antiGaming]) => ({ key, label, section, unit, minN, inScore, direction, definition, formula, goodRange, caveats, antiGaming }));
  const DEF = Object.fromEntries(DEFS.map((d) => [d.key, d]));

  const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const inP = (t, p) => t != null && t >= p.start && t < p.cutoff;
  function isoWeekKey(t) { const d = new Date(dayStart(t)); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day + 3); const y = d.getUTCFullYear(); const jan4 = Date.UTC(y, 0, 4); const wk = 1 + Math.round((d - jan4) / DAY / 7 - ((new Date(jan4).getUTCDay() + 6) % 7 - 3) / 7); return y * 100 + wk; }

  const cache = new Map();
  function metrics(p) {
    const key = p.spec + '|' + p.cutoff;
    if (cache.has(key)) return cache.get(key);
    const incl = (o) => (REPO_BY_NAME[o.repo] || {}).included !== false;
    const AP = prs.filter(incl), RV = reviews.filter(incl), CM = commits.filter(incl);
    const APm = AP.filter((x) => inP(x.mergedAt, p));
    const U = AP.filter((x) => !x.mergedAt && inP(x.closedAt, p));
    const out = {};
    const set = (k, value, n, evidence = []) => { const d = DEF[k]; const ok = n >= d.minN; out[k] = { key: k, value: ok ? value : null, n, status: ok ? 'ok' : 'insufficient_data', evidence }; };
    set('prs_merged', APm.length, APm.length, APm.map((x) => x.id));
    const opened = AP.filter((x) => inP(x.createdAt, p)); set('prs_opened', opened.length, opened.length, opened.map((x) => x.id));
    set('pr_cycle_time_median_hours', median(APm.map((x) => businessHours(x.readyAt, x.mergedAt))), APm.length, APm.map((x) => x.id));
    set('merge_rate', APm.length + U.length ? APm.length / (APm.length + U.length) : null, APm.length + U.length, [...APm, ...U].map((x) => x.id));
    set('small_pr_ratio', APm.length ? APm.filter((x) => x.lines <= 400).length / APm.length : null, APm.length, APm.filter((x) => x.lines <= 400).map((x) => x.id));
    set('revert_rate', APm.length ? APm.filter((x) => x.reverted).length / APm.length : null, APm.length, APm.filter((x) => x.reverted).map((x) => x.id));
    set('pr_size_median_lines', median(APm.map((x) => x.lines)), APm.length, APm.map((x) => x.id));
    set('first_pass_approval_rate', APm.length ? APm.filter((x) => !x.changesRequested).length / APm.length : null, APm.length, APm.filter((x) => !x.changesRequested).map((x) => x.id));
    const rvIn = RV.filter((r) => inP(r.submittedAt, p));
    const byPr = {}; for (const r of rvIn) (byPr[r.prId] = byPr[r.prId] || []).push(r);
    const rpIds = Object.keys(byPr);
    set('prs_reviewed', rpIds.length, rpIds.length, rpIds);
    const tsamp = rpIds.map((id) => byPr[id].sort((a, b) => a.submittedAt - b.submittedAt)[0]).filter((r) => r.requestedAt).map((r) => businessHours(r.requestedAt, r.submittedAt));
    set('review_turnaround_median_hours', median(tsamp), tsamp.length, rpIds);
    const nb = rpIds.length + APm.length; set('review_balance', nb ? rpIds.length / nb : null, nb, []);
    const fr = AP.filter((x) => inP(x.firstReviewAt, p)); set('time_to_first_review_median_hours', median(fr.map((x) => businessHours(x.readyAt, x.firstReviewAt))), fr.length, fr.map((x) => x.id));
    set('review_depth_median', median(rpIds.map((id) => byPr[id].reduce((s, r) => s + r.comments + (r.hasBody ? 1 : 0), 0))), rpIds.length, rpIds);
    const reposRev = new Set(rpIds.map((id) => reviewedById[id].repo)); set('repos_reviewed', reposRev.size, reposRev.size);
    const cmIn = CM.filter((c) => inP(c.authoredAt, p));
    const contrib = new Set([...cmIn.map((c) => c.repo), ...opened.map((x) => x.repo), ...APm.map((x) => x.repo), ...reposRev]);
    set('repos_contributed', contrib.size, contrib.size);
    const mergedRepos = new Set(APm.map((x) => x.repo));
    set('two_way_repos', [...mergedRepos].filter((r) => reposRev.has(r)).length, [...mergedRepos].filter((r) => reposRev.has(r)).length);
    set('repos_with_merged_prs', mergedRepos.size, mergedRepos.size);
    const dates = new Set([...cmIn.map((c) => iso(c.authoredAt)), ...opened.map((x) => iso(x.createdAt)), ...rvIn.map((r) => iso(r.submittedAt))]);
    set('active_days', dates.size, dates.size);
    set('commits', cmIn.length, cmIn.length, cmIn.map((c) => c.id));
    // active weeks: ISO weeks with a weekday inside [start, cutoff)
    const weeks = []; for (let t = p.start; t < p.cutoff; t += DAY) if (!isWeekend(t)) { const k = isoWeekKey(t); if (weeks[weeks.length - 1] !== k) weeks.push(k); }
    const activeW = new Set([...dates].map((d) => isoWeekKey(Date.parse(d + 'T00:00:00Z'))));
    const act = weeks.filter((w) => activeW.has(w)).length;
    set('active_weeks_ratio', weeks.length ? act / weeks.length : null, weeks.length);
    let best = 0, run = 0; for (const w of weeks) { if (activeW.has(w)) { run++; best = Math.max(best, run); } else run = 0; }
    set('longest_active_week_streak', best, weeks.length);
    out._activeWeeks = act; out._weeks = weeks.length;
    cache.set(key, out);
    return out;
  }

  // ---------- impact (KPI_METHODOLOGY §6) ----------
  const band = (x, pts) => { if (x <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0); } return pts[pts.length - 1][1]; };
  const shrunk = (s, n) => (n * s + 3 * 50) / (n + 3);
  const DIMS = [
    { key: 'delivery', label: 'Delivery', weight: 0.30, summary: 'PRs merged, cycle time, steady weeks', comps: [
      { metric: 'prs_merged', weight: 0.5, per28: true, shrink: false, anchors: [[0, 0], [2, 40], [4, 60], [8, 85], [12, 100]] },
      { metric: 'pr_cycle_time_median_hours', weight: 0.3, shrink: true, anchors: [[4, 100], [24, 85], [72, 60], [168, 30], [336, 0]] },
      { metric: 'active_weeks_ratio', weight: 0.2, shrink: false, anchors: [[0, 0], [0.5, 50], [0.75, 80], [1, 100]] }] },
    { key: 'quality', label: 'Quality', weight: 0.25, summary: 'small PRs, reverts, merge rate', comps: [
      { metric: 'small_pr_ratio', weight: 0.4, shrink: true, anchors: [[0, 0], [0.5, 60], [0.8, 90], [1, 100]] },
      { metric: 'revert_rate', weight: 0.35, shrink: true, anchors: [[0, 100], [0.05, 80], [0.1, 50], [0.25, 0]] },
      { metric: 'merge_rate', weight: 0.25, shrink: true, anchors: [[0, 0], [0.5, 40], [0.8, 80], [0.9, 100]] }] },
    { key: 'collaboration', label: 'Collaboration', weight: 0.30, summary: 'PRs reviewed, review turnaround, review balance', comps: [
      { metric: 'prs_reviewed', weight: 0.5, per28: true, shrink: false, anchors: [[0, 0], [2, 40], [5, 65], [10, 90], [15, 100]] },
      { metric: 'review_turnaround_median_hours', weight: 0.3, shrink: true, anchors: [[2, 100], [8, 85], [24, 65], [72, 30], [168, 0]] },
      { metric: 'review_balance', weight: 0.2, shrink: true, anchors: [[0, 0], [0.3, 70], [0.5, 100], [1, 100]] }] },
    { key: 'ownership', label: 'Ownership', weight: 0.15, summary: 'repositories where you both ship and review, breadth', comps: [
      { metric: 'two_way_repos', weight: 0.6, shrink: false, anchors: [[0, 0], [1, 60], [2, 80], [3, 100]] },
      { metric: 'repos_contributed', weight: 0.4, shrink: false, anchors: [[0, 0], [1, 40], [3, 75], [5, 100]] }] },
  ];
  const BANDS = [{ min: 0, max: 39, label: 'Low signal' }, { min: 40, max: 59, label: 'Moderate' }, { min: 60, max: 79, label: 'Strong' }, { min: 80, max: 100, label: 'Very strong' }];
  const bandLabel = (s) => (s == null ? null : BANDS.find((b) => s >= b.min && s <= b.max).label);
  const roundHalfUp = (x) => Math.floor(x + 0.5);

  function computeImpact(m, periodDays) {
    const dims = DIMS.map((d) => {
      const comps = d.comps.map((c) => {
        const mv = m[c.metric];
        if (!mv || mv.status !== 'ok' || mv.value == null) return { ...c, value: null, n: mv ? mv.n : 0, bandScore: null, shrunkScore: null, available: false };
        const input = c.per28 ? (mv.value * 28) / periodDays : mv.value;
        const b = band(input, c.anchors);
        const s = c.shrink ? shrunk(b, mv.n) : null;
        return { ...c, value: mv.value, input, n: mv.n, bandScore: b, shrunkScore: s, available: true };
      });
      const av = comps.filter((c) => c.available);
      const wsum = av.reduce((s, c) => s + c.weight, 0);
      const score = av.length ? av.reduce((s, c) => s + (c.weight / wsum) * (c.shrink ? c.shrunkScore : c.bandScore), 0) : null;
      return { key: d.key, label: d.label, summary: d.summary, weight: d.weight, available: av.length > 0, score, comps: comps.map((c) => ({ ...c, effWeight: c.available ? c.weight / wsum : 0 })) };
    });
    const pm = m.prs_merged ? m.prs_merged.n : 0, pr = m.prs_reviewed ? m.prs_reviewed.n : 0;
    const avail = dims.filter((d) => d.available);
    if (periodDays < 7 || pm + pr < 3 || avail.length < 2) return { status: 'insufficient_data', overall: null, overallRaw: null, band: null, dims };
    const ws = avail.reduce((s, d) => s + d.weight, 0);
    const raw = avail.reduce((s, d) => s + d.weight * d.score, 0) / ws;
    return { status: 'ok', overall: roundHalfUp(raw), overallRaw: raw, band: bandLabel(roundHalfUp(raw)), dims };
  }
  function impact(p) { const m = metrics(p); return computeImpact(m, p.days); }

  // ---------- feed / heatmap / series ----------
  const REPO_BY_NAME = Object.fromEntries([...REPOS, ...EXTRA_REPOS].map((r) => [r.name, r]));
  function feed() {
    const items = [];
    for (const x of prs) {
      items.push({ id: 'o-' + x.id, type: 'pr_opened', t: x.createdAt, repo: x.repo, title: x.title, ref: x.ref, src: x });
      if (x.mergedAt) items.push({ id: 'm-' + x.id, type: 'pr_merged', t: x.mergedAt, repo: x.repo, title: x.title, ref: x.ref, src: x });
      else if (x.closedAt) items.push({ id: 'x-' + x.id, type: 'pr_closed', t: x.closedAt, repo: x.repo, title: x.title, ref: x.ref, src: x });
    }
    for (const r of reviews) { const rp = reviewedById[r.prId]; items.push({ id: r.id, type: 'review', t: r.submittedAt, repo: r.repo, title: rp.title, ref: rp.ref, src: r, pr: rp }); }
    for (const c of commits) items.push({ id: c.id, type: 'commit', t: c.authoredAt, repo: c.repo, title: c.message, ref: c.ref, src: c });
    for (const a of achievements) items.push({ id: a.id, type: 'achievement', t: Date.parse(a.occurredOn + 'T17:00:00Z'), repo: null, title: a.title, ref: a.ref, src: a });
    return items.filter((i) => i.t <= TODAY).sort((a, b) => b.t - a.t);
  }
  const FEED = feed();
  function daily(from, to) {
    const days = [];
    for (let t = dayStart(from); t < to; t += DAY) days.push({ t, date: iso(t), commits: 0, prsOpened: 0, prsMerged: 0, reviews: 0 });
    const idx = (t) => Math.floor((dayStart(t) - dayStart(from)) / DAY);
    const add = (t, k) => { if (t == null || t < from || t >= to) return; const d = days[idx(t)]; if (d) d[k]++; };
    commits.forEach((c) => add(c.authoredAt, 'commits'));
    prs.forEach((x) => { add(x.createdAt, 'prsOpened'); add(x.mergedAt, 'prsMerged'); });
    reviews.forEach((r) => add(r.submittedAt, 'reviews'));
    days.forEach((d) => (d.count = d.commits + d.prsOpened + d.prsMerged + d.reviews));
    return days;
  }
  function monthSpec(t) { const d = new Date(t); return `month:${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; }
  function lastMonths(n, endT = TODAY) { const out = []; const d = new Date(endT); for (let i = n - 1; i >= 0; i--) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)); out.push(monthSpec(x.getTime())); } return out; }
  function lookup(id) { return prs.find((x) => x.id === id) || reviewedById[id] || commits.find((c) => c.id === id) || achievements.find((a) => a.id === id); }

  // documents library (seed)
  const documents = [
    { id: 'd1', type: 'appraisal', title: 'Appraisal — H1 2026', period: 'half:2026-H1', status: 'ready', version: 3, source: 'user_edit', coverage: 0.97, flags: { uncited: 0, invalid: 0 }, createdAt: Date.UTC(2026, 6, 2, 10), updatedAt: Date.UTC(2026, 6, 4, 16) },
    { id: 'd2', type: 'resume', title: 'Resume bullets — Backend', period: 'custom:2025-11-01..2026-10-31', status: 'ready', version: 1, source: 'generated', coverage: 1, flags: { uncited: 0, invalid: 0 }, createdAt: Date.UTC(2026, 9, 28, 9), updatedAt: Date.UTC(2026, 9, 28, 9) },
    { id: 'd3', type: 'promotion', title: 'Promotion packet — Senior Software Engineer', period: 'custom:2025-11-01..2026-10-31', status: 'ready', version: 2, source: 'regenerated', coverage: 0.93, flags: { uncited: 1, invalid: 0 }, createdAt: Date.UTC(2026, 9, 30, 14), updatedAt: Date.UTC(2026, 10, 2, 11) },
  ];
  const goals = [
    { id: 'g1', title: 'Keep review turnaround under 8 business hours', metricTarget: { metricKey: 'review_turnaround_median_hours', comparator: 'lte', targetValue: 8 }, startDate: '2026-07-01', targetDate: '2026-12-31', status: 'active', achievementIds: [] },
    { id: 'g2', title: 'Keep at least 75% of my PRs small', metricTarget: { metricKey: 'small_pr_ratio', comparator: 'gte', targetValue: 0.75 }, startDate: '2026-07-01', targetDate: '2026-12-31', status: 'active', achievementIds: [] },
    { id: 'g3', title: 'Write two design docs this half', metricTarget: null, startDate: '2026-07-01', targetDate: '2026-12-31', status: 'active', achievementIds: ['a5'] },
  ];
  const syncRuns = [
    { id: 's5', trigger: 'scheduled', status: 'succeeded', queuedAt: TODAY - 0.2 * DAY, durationS: 42, counts: { prsAuthored: 2, prsReviewed: 3, reviews: 4, commits: 7 }, errors: [] },
    { id: 's4', trigger: 'webhook', status: 'succeeded', queuedAt: TODAY - 0.9 * DAY, durationS: 3, counts: { prsAuthored: 1, prsReviewed: 0, reviews: 0, commits: 2 }, errors: [] },
    { id: 's3', trigger: 'scheduled', status: 'partial', queuedAt: TODAY - 1.2 * DAY, durationS: 61, counts: { prsAuthored: 1, prsReviewed: 2, reviews: 2, commits: 4 }, errors: [{ repo: 'harbor-io/ledger-service', code: 'REPO_NOT_ACCESSIBLE', message: 'The GitHub App no longer has access to this repository.' }] },
    { id: 's2', trigger: 'manual', status: 'succeeded', queuedAt: TODAY - 3.3 * DAY, durationS: 38, counts: { prsAuthored: 0, prsReviewed: 2, reviews: 3, commits: 1 }, errors: [] },
    { id: 's1', trigger: 'initial', status: 'succeeded', queuedAt: Date.UTC(2026, 9, 1, 9), durationS: 214, counts: { prsAuthored: prs.length, prsReviewed: reviewed.length, reviews: reviews.length, commits: commits.length }, errors: [] },
  ];

  window.DI = { DAY, HOUR, TODAY, USER, REPOS, EXTRA_REPOS, REPO_BY_NAME, prs, reviewed, reviews, commits, achievements, documents, goals, syncRuns,
    FEED, DEFS, DEF, DIMS, BANDS, bandLabel, period, previous, metrics, impact, computeImpact, daily, lastMonths, monthSpec, lookup, reviewedById,
    businessHours, fmtDate, iso, MONTHS, MON, isoWeekKey, roundHalfUp };
})();
