/* DevImpact AI v2 prototype — app shell, routing, screens, charts and overlays.
   Vanilla JS, hash routing (plain #name only). Prototype-only controls live in the dashed "Prototype" menu. */
(function () {
  'use strict';
  const DI = window.DI;
  const { DAY, HOUR, TODAY } = DI;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (n, cls = '') => `<i data-lucide="${n}" class="${cls}" aria-hidden="true"></i>`;
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = { get(k, d) { try { const v = localStorage.getItem('di-proto-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('di-proto-' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } } };

  // ------------------------------------------------------------------ state
  const S = {
    scenario: store.get('scenario', 'populated'),
    period: 'month:2026-11',
    theme: store.get('theme', 'system'),
    docs: DI.documents.map((d) => ({ ...d })),
    achievements: DI.achievements.map((a) => ({ ...a })),
    goals: DI.goals.map((g) => ({ ...g })),
    repos: [...DI.REPOS, ...DI.EXTRA_REPOS].map((r) => ({ ...r })),
    usage: { gen: 3, quick: 12 },
    overlay: null, popover: null, cmdk: false, proto: false, toasts: [],
    act: { type: 'all', repo: 'all', q: '', shown: 40 },
    ach: { cat: 'all' },
    docsFilter: { type: 'all', q: '' },
    career: { year: 2026, expanded: {} },
    currentDoc: 'd1', docEdit: false, docSave: 'saved', gen: null,
    showTables: {}, onboarding: { repoSel: null, sync: null, denied: false, tzOpen: false },
    settings: { digest: true, digestDay: 1, digestHour: 9, notifySync: true, notifyDoc: false, redact: true, tz: 'Europe/London', name: DI.USER.name, role: DI.USER.currentRole, level: DI.USER.careerLevel, target: DI.USER.targetRole, defaultPeriod: 'month' },
    exportState: 'idle', highlights: null, impactPeriod: null, singleKeys: store.get('keys', true),
  };
  const SCENARIOS = [
    ['populated', 'Populated (seeded user)'], ['first-run', 'First run — nothing connected'], ['syncing', 'First sync — recent 30 days ready'],
    ['loading', 'Loading (skeletons)'], ['error', 'API error'], ['sync-failed', 'Last sync failed'], ['needs-reauth', 'GitHub needs reconnection'],
    ['rate-limited', 'Sync paused by GitHub rate limit'], ['quota', 'AI quota used up'],
  ];

  const ROUTES = {
    'sign-in': { shell: false, title: 'Sign in' },
    'onboarding-connect': { shell: false, title: 'Connect GitHub' }, 'onboarding-pending': { shell: false, title: 'Approval pending' },
    'onboarding-repos': { shell: false, title: 'Review repositories' }, 'onboarding-sync': { shell: false, title: 'First sync' },
    dashboard: { title: 'Dashboard', nav: 'dashboard', period: true },
    activity: { title: 'Activity', nav: 'activity', period: true },
    kpis: { title: 'KPIs', nav: 'kpis', period: true },
    impact: { title: 'Impact score', nav: 'kpis', parent: ['kpis', 'KPIs'], period: true },
    career: { title: 'Career', nav: 'career' },
    documents: { title: 'Documents', nav: 'documents' },
    'new-document': { title: 'New document', nav: 'documents', parent: ['documents', 'Documents'] },
    'new-resume': { title: 'New resume', nav: 'documents', parent: ['documents', 'Documents'] },
    'new-appraisal': { title: 'New appraisal', nav: 'documents', parent: ['documents', 'Documents'] },
    'new-promotion': { title: 'New promotion packet', nav: 'documents', parent: ['documents', 'Documents'] },
    document: { title: 'Document', nav: 'documents', parent: ['documents', 'Documents'] },
    achievements: { title: 'Achievements', nav: 'achievements' },
    goals: { title: 'Goals', nav: 'goals' },
    'account-integrations': { title: 'Integrations', nav: 'account-integrations', parent: [null, 'Settings'] },
    'account-profile': { title: 'Profile', nav: 'account-profile', parent: [null, 'Settings'] },
    'account-notifications': { title: 'Notifications', nav: 'account-notifications', parent: [null, 'Settings'] },
    'account-privacy': { title: 'Privacy & data', nav: 'account-privacy', parent: [null, 'Settings'] },
    'account-plan': { title: 'Plan & usage', nav: 'account-plan', parent: [null, 'Settings'] },
    'server-error': { title: 'Something went wrong' }, 'not-found': { title: 'Page not found' },
  };
  const NAV = [
    ['Overview', [['dashboard', 'Dashboard', 'layout-dashboard'], ['activity', 'Activity', 'list'], ['kpis', 'KPIs', 'gauge'], ['career', 'Career', 'milestone']]],
    ['Create', [['documents', 'Documents', 'file-text'], ['achievements', 'Achievements', 'award'], ['goals', 'Goals', 'target']]],
    ['Settings', [['account-integrations', 'Integrations', 'plug'], ['account-profile', 'Profile', 'user'], ['account-notifications', 'Notifications', 'bell'], ['account-privacy', 'Privacy & data', 'shield'], ['account-plan', 'Plan & usage', 'gauge-circle']]],
  ];
  const route = () => { const h = location.hash.replace('#', ''); if (!h) return 'dashboard'; return ROUTES[h] ? h : 'not-found'; };
  const go = (r) => { if (location.hash === '#' + r) render(); else location.hash = r; };

  // ------------------------------------------------------------------ formatting
  const P = () => DI.period(S.period);
  const fmtN = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
  function fmtVal(key, v) {
    if (v == null) return '—';
    const u = DI.DEF[key] ? DI.DEF[key].unit : 'count';
    if (u === 'hours') return `${v.toFixed(1)}<span class="unit">h</span>`;
    if (u === 'ratio') return `${Math.round(v * 100)}<span class="unit">%</span>`;
    if (u === 'comments') return v.toFixed(1).replace(/\.0$/, '');
    if (u === 'lines') return `${fmtN(v)}<span class="unit">lines</span>`;
    return fmtN(v);
  }
  const plain = (key, v) => fmtVal(key, v).replace(/<[^>]+>/g, '').replace(/(\d)(h|%)/, '$1 $2').replace('% ', '%').replace(' %', '%');
  const rel = (t) => { const s = (TODAY - t) / 1000; if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; const d = Math.round(s / 86400); return d === 1 ? 'yesterday' : `${d} days ago`; };
  const time = (t) => new Date(t).toISOString().slice(11, 16);
  const dateLong = (t) => { const d = new Date(t); return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]}, ${DI.MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
  function deltaHtml(cur, prev, unitKey, opts = {}) {
    if (cur == null || prev == null) return `<span class="delta">No comparison</span>`;
    const d = cur - prev; const u = DI.DEF[unitKey] ? DI.DEF[unitKey].unit : 'points';
    const fmt = u === 'ratio' ? `${Math.abs(Math.round(d * 100))} pts` : u === 'hours' ? `${Math.abs(d).toFixed(1)} h` : u === 'points' ? `${Math.abs(Math.round(d))} pts` : fmtN(Math.abs(d));
    const ico = d > 0 ? 'arrow-up-right' : d < 0 ? 'arrow-down-right' : 'minus';
    const word = d > 0 ? 'up' : d < 0 ? 'down' : 'no change';
    return `<span class="delta">${icon(ico)}<span class="sr-only">${word}</span>${d === 0 ? 'No change' : `<b>${fmt}</b>`} <span class="delta-label">${esc(opts.label || 'vs previous period')}</span></span>`;
  }
  const typeLabel = { resume: 'Resume', appraisal: 'Appraisal', promotion: 'Promotion' };
  const statusBadge = { ready: '<span class="badge">Ready</span>', streaming: `<span class="badge badge-accent">${icon('loader-circle', 'spin')} Writing</span>`, pending: '<span class="badge badge-accent">Queued</span>', failed: '<span class="badge badge-danger">Failed</span>', cancelled: '<span class="badge">Cancelled</span>' };

  // ------------------------------------------------------------------ toasts
  function toast(msg, kind = 'ok', action) {
    const id = Math.random().toString(36).slice(2);
    S.toasts.push({ id, msg, kind, action });
    renderToasts();
    setTimeout(() => { S.toasts = S.toasts.filter((t) => t.id !== id); renderToasts(); }, action ? 7000 : 4500);
  }
  function renderToasts() {
    const el = $('#toasts');
    el.innerHTML = S.toasts.map((t) => `<div class="toast ${t.kind}" role="${t.kind === 'err' ? 'alert' : 'status'}"><span class="t-ico">${icon(t.kind === 'err' ? 'circle-alert' : t.kind === 'info' ? 'info' : 'circle-check')}</span><div class="spacer">${t.msg}</div>${t.action ? `<button class="link-btn small" data-action="${t.action[1]}">${esc(t.action[0])}</button>` : ''}</div>`).join('');
    icons(el);
  }

  // ------------------------------------------------------------------ charts
  const charts = {};
  let chartSeq = 0;
  function chartSlot(spec) { const id = 'ch' + ++chartSeq; charts[id] = spec; return `<div class="chart-slot" id="${id}" style="height:${spec.height || 180}px"></div>`; }
  function niceMax(v) { if (v <= 4) return 4; if (v <= 10) return Math.ceil(v / 2) * 2; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
  function drawCharts() { for (const id of Object.keys(charts)) { const el = document.getElementById(id); if (!el) { delete charts[id]; continue; } const sp = charts[id]; el.innerHTML = sp.type === 'line' ? lineSvg(el.clientWidth, sp) : columnSvg(el.clientWidth, sp); } }
  function columnSvg(W, sp) {
    const H = sp.height || 180, m = { l: 30, r: 8, t: 10, b: 24 };
    const pw = Math.max(10, W - m.l - m.r), ph = H - m.t - m.b;
    const n = sp.rows.length; const totals = sp.rows.map((r) => sp.series.reduce((s, se) => s + (r[se.key] || 0), 0));
    const max = niceMax(Math.max(1, ...totals)); const y = (v) => m.t + ph - (v / max) * ph;
    const band = pw / n, bw = Math.min(24, Math.max(3, band * 0.62));
    let g = '';
    [0, max / 2, max].forEach((t) => { g += `<line class="${t === 0 ? 'axis-line' : 'grid-line'}" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${fmtN(t)}</text>`; });
    const every = Math.ceil(n / Math.max(2, Math.floor(pw / 64)));
    sp.rows.forEach((r, i) => {
      const cx = m.l + band * i + band / 2; let acc = 0;
      const tip = `<div class='t-title'>${esc(r.label)}</div>` + sp.series.map((se) => `<div class='t-row'><span><i style='background:var(${se.color})'></i>${esc(se.label)}</span><b>${fmtN(r[se.key])}</b></div>`).join('') + (sp.series.length > 1 ? `<div class='t-row subtle'><span>Total</span><b>${fmtN(totals[i])}</b></div>` : '');
      g += `<rect class="hover-band" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ph}" fill="transparent"/>`;
      const segs = sp.series.map((se) => ({ se, v: r[se.key] || 0 })).filter((s) => s.v > 0);
      segs.forEach((s, si) => {
        const y0 = y(acc), y1 = y(acc + s.v); acc += s.v;
        const top = si === segs.length - 1; const h = Math.max(0, y0 - y1 - (si > 0 ? 2 : 0)); const yy = y1;
        const x = cx - bw / 2, rr = top ? Math.min(4, bw / 2, h) : 0;
        g += rr ? `<path d="M${x},${yy + h} L${x},${yy + rr} Q${x},${yy} ${x + rr},${yy} L${x + bw - rr},${yy} Q${x + bw},${yy} ${x + bw},${yy + rr} L${x + bw},${yy + h} Z" fill="var(${s.se.color})"/>` : `<rect x="${x}" y="${yy}" width="${bw}" height="${h}" fill="var(${s.se.color})"/>`;
      });
      if (i % every === 0) g += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${esc(r.short || r.label)}</text>`;
      g += `<rect class="hit" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ph}" data-tip="${esc(tip)}"/>`;
    });
    return `<svg class="chart" width="${W}" height="${H}" role="img" aria-label="${esc(sp.aria)}">${g}</svg>`;
  }
  function lineSvg(W, sp) {
    const H = sp.height || 180, m = { l: 30, r: 34, t: 12, b: 24 };
    const pw = Math.max(10, W - m.l - m.r), ph = H - m.t - m.b; const n = sp.points.length;
    const max = sp.max || niceMax(Math.max(1, ...sp.points.map((p) => p.value || 0)));
    const x = (i) => m.l + (n === 1 ? pw / 2 : (pw * i) / (n - 1)); const y = (v) => m.t + ph - (v / max) * ph;
    let g = ''; const ticks = sp.ticks || [0, max / 2, max];
    ticks.forEach((t) => { g += `<line class="${t === 0 ? 'axis-line' : 'grid-line'}" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`; });
    let d = '', pen = false;
    sp.points.forEach((p, i) => { if (p.value == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i)},${y(p.value)} `; pen = true; });
    g += `<path d="${d}" fill="none" stroke="var(--chart-5)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const every = Math.ceil(n / Math.max(2, Math.floor(pw / 56)));
    sp.points.forEach((p, i) => {
      if (i % every === 0 || i === n - 1) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(p.short)}</text>`;
      if (p.value != null) g += `<circle cx="${x(i)}" cy="${y(p.value)}" r="${i === n - 1 ? 5 : 4}" fill="var(--chart-5)" stroke="var(--surface)" stroke-width="2"/>`;
      else g += `<text x="${x(i)}" y="${m.t + ph - 6}" text-anchor="middle" class="na">–</text>`;
      const tip = `<div class='t-title'>${esc(p.label)}</div><div class='t-row'><span>${esc(sp.seriesLabel)}</span><b>${p.value == null ? 'Not enough data' : fmtN(p.value)}</b></div>${p.note ? `<div class='subtle'>${esc(p.note)}</div>` : ''}`;
      g += `<rect class="hit" x="${x(i) - pw / n / 2}" y="${m.t}" width="${pw / n}" height="${ph}" data-tip="${esc(tip)}"/>`;
    });
    const last = [...sp.points].reverse().find((p) => p.value != null);
    if (last) { const li = sp.points.lastIndexOf(last); g += `<text x="${x(li) + 9}" y="${y(last.value) + 4}" style="fill:var(--foreground);font-weight:600">${last.value}</text>`; }
    return `<svg class="chart" width="${W}" height="${H}" role="img" aria-label="${esc(sp.aria)}">${g}</svg>`;
  }
  function spark(values, w = 96, h = 28) {
    const vals = values.map((v) => (v == null ? null : v)); const nums = vals.filter((v) => v != null);
    if (nums.length < 2) return `<span class="caption subtle">No trend yet</span>`;
    const mx = Math.max(...nums), mn = Math.min(...nums); const span = mx - mn || 1;
    const x = (i) => 3 + ((w - 6) * i) / (vals.length - 1); const y = (v) => h - 4 - ((v - mn) / span) * (h - 8);
    let d = '', pen = false; vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `; pen = true; });
    const li = vals.length - 1; const lv = vals[li];
    return `<svg width="${w}" height="${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--chart-muted)" stroke-width="1.5" stroke-linejoin="round"/>${lv != null ? `<circle cx="${x(li)}" cy="${y(lv)}" r="3" fill="var(--chart-5)"/>` : ''}</svg>`;
  }
  function tableToggle(id, label = 'View as table') { const on = S.showTables[id]; return `<button class="link-btn data-table-toggle" data-action="toggle-table" data-id="${id}" aria-expanded="${!!on}">${on ? 'Hide table' : label}</button>`; }

  // ------------------------------------------------------------------ skeleton / error / empty helpers
  const sk = (w, h, extra = '') => `<div class="sk" style="width:${w};height:${h}px;${extra}"></div>`;
  function skeletonPage(kind) {
    const cards = `<div class="grid g-4">${[1, 2, 3, 4].map(() => `<div class="card stat">${sk('40%', 14)}${sk('55%', 28)}${sk('70%', 12)}</div>`).join('')}</div>`;
    const block = (h) => `<div class="card card-pad stack-3">${sk('30%', 16)}${sk('100%', h)}</div>`;
    if (kind === 'list') return `<div class="card">${[1, 2, 3, 4, 5, 6].map(() => `<div class="list-item">${sk('28px', 28, 'border-radius:50%')}<div class="stack-2 spacer">${sk('60%', 13)}${sk('35%', 11)}</div></div>`).join('')}</div><p class="sr-only" role="status">Loading…</p>`;
    return `<div class="stack-4" aria-busy="true">${cards}<div class="grid g-main">${block(180)}${block(180)}</div>${block(90)}<p class="sr-only" role="status">Loading your data…</p></div>`;
  }
  function errorPanel(what) {
    return `<div class="card"><div class="empty"><div class="e-ico">${icon('cloud-off')}</div><h2>Couldn't load ${esc(what)}</h2><p>The DevImpact API didn't respond. Your data is safe — this is a connection problem on our side.</p><div class="e-actions"><button class="btn btn-primary" data-action="retry">${icon('rotate-cw')}Try again</button><a class="btn" href="#account-integrations">Check sync status</a></div><p class="caption subtle">Request ID 7f3c9a1e-52b0-4c1e-9d0a-3b8e61f4a2c7</p></div></div>`;
  }
  function emptyNoIntegration(title) {
    return `<div class="card"><div class="empty"><div class="e-ico">${icon('github')}</div><h2>${esc(title || 'Connect GitHub to see your impact')}</h2><p>DevImpact reads your pull requests, reviews and commits (read-only) and turns them into KPIs you can explain. It takes about 3 minutes.</p><div class="e-actions"><a class="btn btn-primary" href="#onboarding-connect">${icon('plug')}Connect GitHub</a><a class="btn" href="#kpis">How metrics work</a></div></div></div>`;
  }
  const blocked = () => ['loading', 'error', 'first-run'].includes(S.scenario);
  function stateGate(what, kind) {
    if (S.scenario === 'loading') return skeletonPage(kind);
    if (S.scenario === 'error') return errorPanel(what);
    if (S.scenario === 'first-run') return emptyNoIntegration();
    return null;
  }

  // ------------------------------------------------------------------ sync status (topbar + banners)
  function syncState() {
    switch (S.scenario) {
      case 'syncing': return { dot: 'dot-accent dot-pulse', text: 'Importing history · 64%', title: 'Importing older history', tone: 'info' };
      case 'sync-failed': return { dot: 'dot-danger', text: 'Last sync failed', tone: 'danger' };
      case 'needs-reauth': return { dot: 'dot-warning', text: 'Needs reconnection', tone: 'warning' };
      case 'rate-limited': return { dot: 'dot-warning', text: 'Paused until 16:32', tone: 'warning' };
      case 'first-run': return { dot: '', text: 'Not connected', tone: 'none' };
      case 'error': return { dot: 'dot-danger', text: 'Status unavailable', tone: 'none' };
      default: return { dot: 'dot-success', text: 'Synced 12 min ago', tone: 'ok' };
    }
  }
  function banners() {
    switch (S.scenario) {
      case 'needs-reauth': return `<div class="banner banner-warning" role="status"><span class="b-ico">${icon('triangle-alert')}</span><div class="b-body"><span class="b-title">GitHub needs to be reconnected</span><span class="muted">GitHub revoked DevImpact's access on Nov 8. Your data is kept, but nothing new is imported until you reconnect.</span></div><div class="b-actions"><button class="btn btn-sm btn-primary" data-action="reconnect">Reconnect GitHub</button></div></div>`;
      case 'sync-failed': return `<div class="banner banner-danger" role="status"><span class="b-ico">${icon('circle-alert')}</span><div class="b-body"><span class="b-title">Last sync failed at 09:14</span><span class="muted">GitHub returned an error while importing reviews. Data up to Nov 8, 21:02 is shown.</span></div><div class="b-actions"><a class="btn btn-sm" href="#account-integrations">View details</a><button class="btn btn-sm btn-primary" data-action="sync-now">Retry sync</button></div></div>`;
      case 'rate-limited': return `<div class="banner banner-warning" role="status"><span class="b-ico">${icon('clock')}</span><div class="b-body"><span class="b-title">Sync paused until 16:32</span><span class="muted">GitHub's rate limit was reached. DevImpact resumes automatically — no action needed.</span></div></div>`;
      case 'syncing': return `<div class="banner banner-info" role="status"><span class="b-ico">${icon('loader-circle', 'spin')}</span><div class="b-body"><span class="b-title">Your last 30 days are ready. Older history is still loading.</span><span class="muted">Importing pull requests from Jan–Sep 2026 · 64%. Longer periods may show partial numbers until this finishes.</span><div class="progress" style="margin-top:6px;max-width:360px"><span style="width:64%"></span></div></div></div>`;
      default: return '';
    }
  }

  // ------------------------------------------------------------------ shell
  function shell(r, inner) {
    const rt = ROUTES[r]; const ss = syncState();
    const navHtml = NAV.map(([g, items]) => `<div class="nav-group" role="group" aria-labelledby="ng-${g}"><div class="nav-group-label" id="ng-${g}">${g}</div>${items.map(([k, label, ic]) => `<a class="nav-item" href="#${k}" ${rt.nav === k ? 'aria-current="page"' : ''}>${icon(ic)}${label}${k === 'account-integrations' && ['needs-reauth', 'sync-failed'].includes(S.scenario) ? `<span class="dot ${ss.dot}" aria-label="Needs attention"></span>` : ''}${k === 'documents' && S.gen && S.gen.status === 'streaming' ? `<span class="count">${icon('loader-circle', 'spin')}</span>` : ''}</a>`).join('')}</div>`).join('');
    const crumbs = rt.parent ? `${rt.parent[0] ? `<a href="#${rt.parent[0]}">${rt.parent[1]}</a>` : `<span class="muted">${rt.parent[1]}</span>`}<span class="sep">/</span>` : '';
    const title = r === 'document' ? (curDoc() ? curDoc().title : 'Document') : rt.title;
    const periodBtn = rt.period && !blocked() ? `<button class="btn btn-sm" id="period-btn" data-action="open-period" aria-haspopup="dialog" aria-expanded="${S.popover === 'period'}">${icon('calendar')}<span class="hide-sm">${esc(P().label)}</span><span class="sm-only">${esc(shortPeriod(P()))}</span>${P().inProgress ? '<span class="badge hide-sm" style="height:18px">In progress</span>' : ''}${icon('chevron-down')}</button>` : '';
    return `<a class="skip-link" href="#main" data-action="skip">Skip to content</a>
    <div class="app">
      <nav class="sidebar" aria-label="Main">
        <a class="brand" href="#dashboard"><span class="brand-mark">${icon('activity')}</span>DevImpact</a>
        <button class="btn btn-sm" style="justify-content:flex-start;color:var(--muted-foreground)" data-action="cmdk">${icon('search')}Search or jump to…<span class="spacer"></span><span class="kbd">⌘K</span></button>
        ${navHtml}
        <div class="sidebar-foot">
          <a class="nav-item" href="#account-integrations" style="font-weight:400">${ss.dot ? `<span class="dot ${ss.dot}"></span>` : icon('circle-dashed')}<span class="small">${esc(ss.text)}</span></a>
          <button class="nav-item" style="border:0;background:none;width:100%;cursor:pointer" data-action="open-user" id="user-btn" aria-haspopup="menu"><span class="avatar">${DI.USER.initials}</span><span class="stack" style="gap:0;text-align:left"><span style="color:var(--foreground)">${esc(S.settings.name)}</span><span class="caption subtle">Free plan</span></span></button>
        </div>
      </nav>
      <div class="main">
        <header class="topbar">
          <button class="btn btn-ghost btn-icon mobile-only" data-action="open-nav" aria-label="Open navigation">${icon('menu')}</button>
          <div class="crumbs minw0">${crumbs}<span class="truncate" style="color:var(--foreground)">${esc(title)}</span></div>
          <span class="spacer"></span>
          ${periodBtn}
          <a class="btn btn-sm btn-ghost desktop-only" href="#account-integrations" title="Sync status">${ss.dot ? `<span class="dot ${ss.dot}"></span>` : ''}<span class="small">${esc(ss.text)}</span></a>
          <button class="btn btn-ghost btn-icon btn-sm mobile-only" data-action="cmdk" aria-label="Search">${icon('search')}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-action="theme" id="theme-btn" aria-label="Theme: ${S.theme}. Change theme">${icon(S.theme === 'dark' ? 'moon' : S.theme === 'light' ? 'sun' : 'sun-moon')}</button>
          <button class="btn btn-sm btn-primary hide-sm" data-action="open-new" id="new-btn" aria-haspopup="menu">${icon('plus')}New</button>
        </header>
        <main id="main" class="content ${['document', 'new-resume', 'new-appraisal', 'new-promotion', 'account-profile', 'account-notifications', 'account-privacy', 'account-plan'].includes(r) ? '' : ''}" tabindex="-1">${inner}</main>
      </div>
    </div>
    <nav class="bottombar" aria-label="Primary">
      ${[['dashboard', 'Home', 'layout-dashboard'], ['activity', 'Activity', 'list'], ['kpis', 'KPIs', 'gauge'], ['documents', 'Docs', 'file-text']].map(([k, l, ic]) => `<a href="#${k}" ${rt.nav === k ? 'aria-current="page"' : ''}>${icon(ic)}${l}</a>`).join('')}
      <button data-action="open-nav" aria-label="More navigation">${icon('menu')}More</button>
    </nav>`;
  }
  const shortPeriod = (p) => (p.type === 'month' ? `${DI.MON[new Date(p.start).getUTCMonth()]} ${new Date(p.start).getUTCFullYear()}` : p.label);

  // ------------------------------------------------------------------ screens: auth + onboarding
  function vSignIn() {
    return `<div class="auth"><div class="auth-card">
      <div class="row" style="gap:10px"><span class="brand-mark" style="width:28px;height:28px">${icon('activity')}</span><b style="font-size:16px">DevImpact</b></div>
      <div class="stack-2"><h1>Sign in to DevImpact</h1><p class="muted">Your engineering work, measured fairly and written up for you — every claim backed by a PR.</p></div>
      <div class="stack-2">
        <button class="btn btn-lg btn-primary btn-block" data-action="signin">${icon('github')}Continue with GitHub</button>
        <button class="btn btn-lg btn-block" data-action="signin">${icon('mail')}Continue with Google</button>
      </div>
      <p class="caption subtle">Signing in only reads your name and email. Connecting repository data is a separate, read-only step you control.</p>
      <div class="well stack"><span class="small" style="font-weight:500">Development only</span><span class="caption subtle">Shown when <span class="mono">ENABLE_DEV_LOGIN=true</span> outside production.</span><button class="btn btn-sm" style="align-self:flex-start;margin-top:6px" data-action="signin-demo">Sign in as demo@devimpact.dev</button></div>
    </div></div>`;
  }
  function stepper(i) {
    const steps = ['Connect GitHub data', 'Review repositories', 'First sync'];
    return `<ol class="stepper" aria-label="Setup progress">${steps.map((s, k) => `<li class="${k < i ? 'done' : k === i ? 'current' : ''}" ${k === i ? 'aria-current="step"' : ''}><span class="bar"></span><span>Step ${k + 1} · ${s}</span></li>`).join('')}</ol>`;
  }
  function onboardHead() { return `<div class="row" style="margin-bottom:28px"><span class="brand-mark">${icon('activity')}</span><b>DevImpact</b><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-action="theme" aria-label="Change theme">${icon('sun-moon')}</button><a class="btn btn-ghost btn-sm" href="#dashboard">Finish later</a></div>`; }
  function vOnbConnect() {
    return `<div class="onboard">${onboardHead()}${stepper(0)}
      <div class="stack-6">
        <div class="stack-2"><h1>Connect your GitHub data</h1><p class="muted" style="max-width:60ch">Install the DevImpact GitHub App on your account or organization. You choose the repositories on GitHub, and you can change them at any time.</p></div>
        ${S.onboarding.denied ? `<div class="banner banner-danger" role="alert"><span class="b-ico">${icon('circle-alert')}</span><div class="b-body"><span class="b-title">GitHub authorization was cancelled</span><span class="muted">Nothing was connected. Install the app again when you're ready.</span></div></div>` : ''}
        <div class="card"><div class="card-body stack-4" style="padding-top:16px">
          <h2 style="font-size:15px">What DevImpact can see</h2>
          <ul class="list">${[['eye', 'Read-only access', 'Pull requests, reviews, commits and repository metadata. DevImpact can never push code, comment or merge.'], ['folder-git-2', 'Only repositories you pick', 'Choose "All" or "Only select repositories" on GitHub. Private repository names can be redacted from AI output.'], ['refresh-cw', 'Kept up to date', 'A daily sync plus GitHub webhooks for near-real-time updates.']].map(([ic, t, d]) => `<li class="row" style="align-items:flex-start;gap:12px;padding:8px 0"><span class="feed-ico">${icon(ic)}</span><span class="stack"><b style="font-weight:500">${t}</b><span class="muted small">${d}</span></span></li>`).join('')}</ul>
        </div><div class="card-foot"><button class="btn btn-primary" data-action="install-app" id="install-btn">${icon('github')}Install GitHub App</button><span class="spacer"></span><a class="small" href="#onboarding-pending">My organization needs to approve apps</a></div></div>
        <p class="caption subtle">Signed in as ${esc(DI.USER.email)} · Times will be shown in ${esc(S.settings.tz)} (from your browser) · You can change this in Profile.</p>
      </div></div>`;
  }
  function vOnbPending() {
    return `<div class="onboard">${onboardHead()}${stepper(0)}
      <div class="card"><div class="empty" style="align-items:flex-start;text-align:left;padding:24px">
        <div class="e-ico">${icon('hourglass')}</div>
        <h2>Waiting for harbor-io to approve DevImpact</h2>
        <p>You asked to install DevImpact on <b>harbor-io</b>. An organization owner must approve it on GitHub before DevImpact can read those repositories. GitHub has notified the owners.</p>
        <div class="well stack-2" style="width:100%;max-width:520px"><span class="small" style="font-weight:500">Message you can send your admin</span><p class="small muted" id="admin-msg">Hi — could you approve the DevImpact GitHub App for harbor-io? It needs read-only access to pull requests, reviews and commits so I can track my own engineering impact. Request: github.com/organizations/harbor-io/settings/installations</p><button class="btn btn-sm" style="align-self:flex-start" data-action="copy" data-target="admin-msg">${icon('copy')}Copy message</button></div>
        <div class="e-actions" style="justify-content:flex-start"><button class="btn btn-primary" data-action="go" data-to="onboarding-repos">Continue with personal repositories</button><button class="btn" data-action="check-approval">${icon('rotate-cw')}Check again</button></div>
        <p class="caption subtle">We'll email you when the organization approves the app, and import its repositories automatically.</p>
      </div></div></div>`;
  }
  function vOnbRepos() {
    const repos = S.repos.filter((r) => !r.inactive || true);
    if (!S.onboarding.repoSel) S.onboarding.repoSel = Object.fromEntries(repos.map((r) => [r.id, r.lastActivity > TODAY - 365 * DAY]));
    const sel = S.onboarding.repoSel; const count = Object.values(sel).filter(Boolean).length;
    return `<div class="onboard">${onboardHead()}${stepper(1)}
      <div class="stack-4">
        <div class="stack-2"><h1>Review repositories</h1><p class="muted">Repositories with activity in the last 12 months are selected. Excluded repositories are never counted in your KPIs or used in documents.</p></div>
        <div class="card">
          <div class="card-head"><h2>${count} of ${repos.length} selected</h2><span class="spacer"></span><button class="btn btn-sm btn-ghost" data-action="repos-recent">Select recently active</button></div>
          <div class="card-body" style="padding:8px 0 0">
            <ul class="list">${repos.map((r) => `<li class="list-item"><button class="switch" role="switch" aria-checked="${!!sel[r.id]}" id="rs-${r.id}" data-action="toggle-repo-sel" data-id="${r.id}" aria-label="Include ${esc(r.name)}"></button><label for="rs-${r.id}" class="stack minw0 spacer" style="cursor:pointer"><span class="truncate" style="font-weight:500">${esc(r.name)}</span><span class="caption subtle">${r.lastActivity > TODAY - 365 * DAY ? `Your last activity ${rel(r.lastActivity)}` : 'No activity from you in the last 12 months'}</span></label>${r.private ? `<span class="badge">${icon('lock')}Private</span>` : '<span class="badge badge-outline">Public</span>'}</li>`).join('')}</ul>
          </div>
          <div class="card-foot"><span class="caption subtle">Missing a repository? <a href="#onboarding-connect">Add it on GitHub</a></span><span class="spacer"></span><a class="btn" href="#onboarding-connect">Back</a><button class="btn btn-primary" data-action="start-sync" ${count ? '' : 'disabled'}>Start import</button></div>
        </div>
      </div></div>`;
  }
  const STAGES = [['repositories', 'Repositories', 'Found 5 repositories you contribute to'], ['authored_prs', 'Your pull requests', 'Newest 30 days first, then the rest of the year'], ['reviewed_prs', 'Pull requests you reviewed', ''], ['commits', 'Commits', 'Default branches only'], ['rollups', 'KPIs and impact score', '']];
  function vOnbSync() {
    const sy = S.onboarding.sync || { stage: 0, pct: 0 };
    const ready = sy.pct >= 58; const done = sy.pct >= 100;
    const counts = [5, Math.round(DI.prs.length * Math.min(1, sy.pct / 70)), Math.round(DI.reviewed.length * Math.max(0, Math.min(1, (sy.pct - 30) / 50))), Math.round(DI.commits.length * Math.max(0, Math.min(1, (sy.pct - 45) / 45))), null];
    return `<div class="onboard">${onboardHead()}${stepper(2)}
      <div class="stack-4">
        <div class="stack-2"><h1>${done ? 'Import complete' : 'Importing your last 12 months'}</h1><p class="muted">${done ? 'Every metric now covers your full history.' : 'This usually takes 1–3 minutes. You can leave this page — the import keeps running.'}</p></div>
        <div class="card"><div class="card-body" style="padding-top:16px">
          <div class="meter-label"><span>${done ? 'Done' : `Overall progress`}</span><span class="num" aria-hidden="true">${Math.round(sy.pct)}%</span></div>
          <div class="progress" role="progressbar" aria-valuenow="${Math.round(sy.pct)}" aria-valuemin="0" aria-valuemax="100" aria-label="Import progress"><span style="width:${sy.pct}%"></span></div>
          <div style="margin-top:12px">${STAGES.map((s, i) => { const st = i < sy.stage || done ? 'done' : i === sy.stage ? 'active' : ''; return `<div class="stage ${st}"><span class="stage-ico">${st === 'done' ? icon('check') : st === 'active' ? icon('loader-circle', 'spin') : ''}</span><span class="stack"><span style="font-weight:500">${s[1]}</span>${s[2] ? `<span class="caption subtle">${s[2]}</span>` : ''}</span><span class="num muted small">${counts[i] != null && (st || i === 0) ? fmtN(counts[i]) : ''}</span></div>`; }).join('')}</div>
        </div></div>
        <div aria-live="polite">${ready ? `<div class="banner banner-info"><span class="b-ico">${icon('circle-check')}</span><div class="b-body"><span class="b-title">${done ? 'Your dashboard is up to date' : 'Your dashboard is ready'}</span><span class="muted">${done ? `${fmtN(DI.prs.length)} pull requests, ${fmtN(DI.reviewed.length)} reviews and ${fmtN(DI.commits.length)} commits imported.` : 'Your last 30 days are in. Older history is still loading and will fill in automatically.'}</span></div><div class="b-actions"><button class="btn btn-primary" data-action="finish-onboarding">Go to dashboard</button></div></div>` : ''}</div>
      </div></div>`;
  }

  // ------------------------------------------------------------------ dashboard
  function vDashboard() {
    const gate = stateGate('your dashboard'); if (gate) return pageHead('Dashboard') + (S.scenario === 'first-run' ? firstRunDashboard() : gate);
    const p = P(), pv = DI.previous(p), m = DI.metrics(p), mp = DI.metrics(pv), imp = DI.impact(p), ip = DI.computeImpact(mp, pv.days);
    const cmpLabel = p.inProgress ? 'vs same point last ' + (p.type === 'month' ? 'month' : p.type) : 'vs ' + pv.label;
    const card = (key, label, ic) => `<div class="card stat"><span class="stat-label">${icon(ic)}${label}<span class="spacer"></span><button class="info-btn" data-action="explain" data-key="${key}" aria-label="How is ${label} calculated?">${icon('info')}</button></span><span class="stat-value">${fmtVal(key, m[key].value)}</span>${deltaHtml(m[key].value, mp[key].value, key, { label: cmpLabel })}</div>`;
    const days = chartRows(p);
    const series = [{ key: 'commits', label: 'Commits', color: '--chart-1' }, { key: 'prsMerged', label: 'PRs merged', color: '--chart-2' }, { key: 'reviews', label: 'Reviews', color: '--chart-3' }];
    const actTable = `<div class="table-wrap" ${S.showTables.act ? '' : 'hidden'}><table class="table"><caption class="sr-only">Activity by ${days.interval}</caption><thead><tr><th>${days.interval === 'day' ? 'Date' : 'Period'}</th><th class="num">Commits</th><th class="num">PRs merged</th><th class="num">Reviews</th></tr></thead><tbody>${days.rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="num">${r.commits}</td><td class="num">${r.prsMerged}</td><td class="num">${r.reviews}</td></tr>`).join('')}</tbody></table></div>`;
    return `${banners()}${pageHead('Dashboard', `${esc(p.label)}${p.inProgress ? ' · in progress' : ''} · ${S.scenario === 'syncing' ? 'importing older history' : 'synced 12 min ago'}`, `<div class="row-wrap"><button class="btn" data-action="cmdk-achievement">${icon('award')}Add achievement</button><a class="btn btn-primary" href="#new-appraisal">${icon('sparkles')}Draft appraisal</a></div>`)}
      <div class="stack-4">
        <section class="grid g-4" aria-label="Key numbers">
          ${card('commits', 'Commits', 'git-commit-horizontal')}${card('prs_merged', 'PRs merged', 'git-merge')}${card('prs_reviewed', 'PRs reviewed', 'message-square-text')}
          <div class="card stat"><span class="stat-label">${icon('gauge')}Impact score<span class="spacer"></span><button class="info-btn" data-action="explain-impact" aria-label="How is the impact score calculated?">${icon('info')}</button></span>${imp.status === 'ok' ? `<span class="stat-value">${imp.overall}<span class="unit">/ 100 · ${imp.band}</span></span>${deltaHtml(imp.overall, ip.overall, null, { label: cmpLabel })}` : `<span class="metric-na" style="margin-top:4px">Not enough activity yet to compute a fair score.</span><a class="caption" href="#impact">Why?</a>`}</div>
        </section>
        <p class="caption subtle sm-only" style="margin-top:-8px">Changes are ${esc(cmpLabel)}.</p>
        <div class="grid g-main">
          <section class="card" aria-labelledby="act-h"><div class="card-head"><h2 id="act-h">Activity</h2><span class="meta">${esc(p.label)} · by ${days.interval}</span><span class="spacer"></span>${tableToggle('act')}</div>
            <div class="card-body stack-3"><div class="legend">${series.map((s) => `<span><i style="background:var(${s.color})"></i>${s.label}</span>`).join('')}</div>${chartSlot({ type: 'col', rows: days.rows, series, height: 268, aria: `Stacked columns of commits, PRs merged and reviews per ${days.interval} for ${p.label}. Use View as table for exact values.` })}${actTable}</div></section>
          ${impactCard(p, imp)}
        </div>
        ${heatmapCard()}
        <div class="grid g-main">
          ${feedCard()}
          <div class="stack-4">${nextBestAction(p, m)}${quickActions()}</div>
        </div>
      </div>`;
  }
  function firstRunDashboard() {
    return `<div class="card"><div class="card-body stack-4" style="padding:24px">
      <div class="stack-2"><h2 style="font-size:17px">Set up DevImpact in three steps</h2><p class="muted">Connect GitHub once. Your dashboard, KPIs and documents fill in from real work — nothing is estimated.</p></div>
      <ol class="list">${[['plug', 'Connect GitHub data', 'Install the read-only GitHub App and pick repositories.', '#onboarding-connect', 'Connect GitHub', true], ['folder-git-2', 'Review repositories', 'Exclude anything that should not count.', null, null, false], ['refresh-cw', 'Watch your first sync', 'Your last 30 days appear within a minute or two.', null, null, false]].map(([ic, t, d, href, cta, active], i) => `<li class="list-item" style="padding-left:0;padding-right:0"><span class="feed-ico" style="${active ? 'background:var(--accent);color:var(--accent-foreground)' : ''}">${icon(ic)}</span><span class="stack spacer"><b style="font-weight:500">${i + 1}. ${t}</b><span class="muted small">${d}</span></span>${href ? `<a class="btn btn-primary" href="${href}">${cta}</a>` : ''}</li>`).join('')}</ol>
    </div></div>
    <div class="grid g-3" style="margin-top:16px">${[['gauge', 'Explainable KPIs', 'Every number links to the PRs behind it.'], ['file-text', 'Documents with evidence', 'Appraisals, promotion packets and resume bullets cite your work.'], ['award', 'Capture what GitHub misses', 'Log mentoring, incidents and design docs as achievements.']].map(([ic, t, d]) => `<div class="card card-pad stack-2"><span class="feed-ico">${icon(ic)}</span><b style="font-weight:500">${t}</b><span class="muted small">${d}</span></div>`).join('')}</div>`;
  }
  function pageHead(title, lede, actions = '') { return `<div class="page-head"><div class="stack minw0 spacer"><h1>${esc(title)}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</div>${actions}</div>`; }
  function chartRows(p) {
    const to = Math.min(p.endEx, TODAY + DAY);
    const d = DI.daily(p.start, to);
    if (p.days <= 45) return { interval: 'day', rows: d.map((x) => ({ ...x, label: dateLong(x.t), short: String(new Date(x.t).getUTCDate()) })) };
    const byWeek = p.days <= 200; const groups = new Map();
    for (const x of d) { const k = byWeek ? DI.isoWeekKey(x.t) : x.date.slice(0, 7); if (!groups.has(k)) groups.set(k, { t: x.t, commits: 0, prsMerged: 0, reviews: 0 }); const g = groups.get(k); g.commits += x.commits; g.prsMerged += x.prsMerged; g.reviews += x.reviews; }
    return { interval: byWeek ? 'week' : 'month', rows: [...groups.values()].map((g) => ({ ...g, label: byWeek ? `Week of ${DI.fmtDate(g.t, false)}` : `${DI.MONTHS[new Date(g.t).getUTCMonth()]} ${new Date(g.t).getUTCFullYear()}`, short: byWeek ? DI.fmtDate(g.t, false) : DI.MON[new Date(g.t).getUTCMonth()] })) };
  }
  function impactCard(p, imp) {
    const dims = imp.dims;
    return `<section class="card" aria-labelledby="imp-h"><div class="card-head"><h2 id="imp-h">Impact score</h2><span class="meta">${esc(p.label)}</span><span class="spacer"></span><a class="btn btn-sm btn-ghost" href="#impact">Details</a></div>
      <div class="card-body stack-4">
        ${imp.status === 'ok' ? `<div class="stack-2"><div class="row" style="align-items:baseline;gap:8px"><span class="score">${imp.overall}</span><span class="score-of">/ 100</span><span class="badge badge-accent" style="margin-left:4px">${imp.band}</span></div>
          <div><div class="band-scale" aria-hidden="true">${DI.BANDS.map((b) => `<span class="${imp.overall >= b.min && imp.overall <= b.max ? 'on' : ''}"></span>`).join('')}</div><div class="band-labels" aria-hidden="true"><span>Low signal</span><span>Moderate</span><span>Strong</span><span>Very strong</span></div></div>
          <p class="caption subtle">Signal from your GitHub activity — not a judgement of your performance.</p></div>`
        : `<div class="well stack-2"><b style="font-weight:500">Not enough activity in this period to compute a fair score</b><span class="small muted">The score needs at least 3 merged or reviewed PRs and 7 days. Try a longer period.</span><button class="btn btn-sm" style="align-self:flex-start" data-action="set-period" data-spec="quarter:2026-Q3">Show Q3 2026</button></div>`}
        <div class="stack-2" role="list" aria-label="Dimensions">${dims.map((d) => `<div class="dim-row" role="listitem"><span class="name">${d.label}</span><div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${d.score == null || imp.status !== 'ok' ? 0 : DI.roundHalfUp(d.score)}%"></div></div><span class="val">${d.score == null || imp.status !== 'ok' ? '<span class="subtle" title="Not enough data">—</span>' : DI.roundHalfUp(d.score)}</span></div>`).join('')}</div>
        ${imp.status === 'ok' && dims.some((d) => !d.available) ? `<p class="caption subtle">${dims.filter((d) => !d.available).map((d) => d.label).join(', ')} isn't scored yet — not enough merged PRs in this period. The other dimensions were re-weighted.</p>` : ''}
        <button class="link-btn small" style="align-self:flex-start" data-action="explain-impact">How is this calculated?</button>
      </div></section>`;
  }
  function heatmapCard() {
    const end = DI.TODAY; const startT = end - 364 * DAY; const s0 = startT - ((new Date(startT).getUTCDay() + 6) % 7) * DAY;
    const days = DI.daily(s0, end + DAY); const nz = days.map((d) => d.count).filter(Boolean).sort((a, b) => a - b);
    const q = (f) => nz[Math.floor(f * (nz.length - 1))] || 1; const th = [q(0.25), q(0.5), q(0.75)];
    const lvl = (c) => (c === 0 ? 0 : c <= th[0] ? 1 : c <= th[1] ? 2 : c <= th[2] ? 3 : 4);
    const loadingBefore = S.scenario === 'syncing' ? TODAY - 30 * DAY : 0;
    let months = '', lastM = -1; const weeks = Math.ceil(days.length / 7);
    for (let w = 0; w < weeks; w++) { const t = days[w * 7].t; const mo = new Date(t).getUTCMonth(); months += `<span style="width:11px;${mo !== lastM && new Date(t).getUTCDate() <= 7 ? '' : 'visibility:hidden'}">${mo !== lastM && new Date(t).getUTCDate() <= 7 ? DI.MON[mo] : '.'}</span>`; if (new Date(t).getUTCDate() <= 7) lastM = mo; }
    const cells = days.map((d) => { if (d.t > end) return '<span class="cell out"></span>'; if (d.t < loadingBefore) return `<span class="cell loading" data-tip="${esc(`<div class='t-title'>${dateLong(d.t)}</div><span class='subtle'>Still importing</span>`)}"></span>`; return `<span class="cell l${lvl(d.count)}" data-tip="${esc(`<div class='t-title'>${dateLong(d.t)}, ${new Date(d.t).getUTCFullYear()}</div><div class='t-row'><span>Commits</span><b>${d.commits}</b></div><div class='t-row'><span>PRs opened</span><b>${d.prsOpened}</b></div><div class='t-row'><span>PRs merged</span><b>${d.prsMerged}</b></div><div class='t-row'><span>Reviews</span><b>${d.reviews}</b></div>`)}"></span>`; }).join('');
    const total = days.reduce((s, d) => s + d.count, 0); const active = days.filter((d) => d.count).length;
    const monthly = []; for (const d of days) { const k = d.date.slice(0, 7); let e = monthly[monthly.length - 1]; if (!e || e.k !== k) { e = { k, c: 0, a: 0 }; monthly.push(e); } e.c += d.count; if (d.count) e.a++; }
    return `<section class="card" aria-labelledby="heat-h"><div class="card-head"><h2 id="heat-h">Contributions</h2><span class="meta">Last 12 months · ${fmtN(total)} contributions on ${active} days</span><span class="spacer"></span>${tableToggle('heat')}</div>
      <div class="card-body stack-3"><div class="heat-wrap" tabindex="0" role="img" aria-label="Contribution heatmap for the last 12 months: ${fmtN(total)} contributions on ${active} active days. Use View as table for monthly totals."><div class="heat-months" aria-hidden="true">${months}</div><div class="heat">${cells}</div></div>
      <div class="row-wrap"><span class="caption subtle">Commits, PRs opened, PRs merged and reviews per day. Weekends are shown but never scored.</span><span class="spacer"></span><span class="heat-legend" aria-hidden="true">Less<span class="cell" style="background:var(--heat-0)"></span><span class="cell" style="background:var(--heat-1)"></span><span class="cell" style="background:var(--heat-2)"></span><span class="cell" style="background:var(--heat-3)"></span><span class="cell" style="background:var(--heat-4)"></span>More</span></div>
      <div class="table-wrap" ${S.showTables.heat ? '' : 'hidden'}><table class="table"><caption class="sr-only">Contributions per month</caption><thead><tr><th>Month</th><th class="num">Contributions</th><th class="num">Active days</th></tr></thead><tbody>${monthly.map((e) => `<tr><td>${DI.MONTHS[+e.k.slice(5) - 1]} ${e.k.slice(0, 4)}</td><td class="num">${e.c}</td><td class="num">${e.a}</td></tr>`).join('')}</tbody></table></div></div></section>`;
  }
  const FEED_ICON = { pr_merged: 'git-merge', pr_opened: 'git-pull-request', pr_closed: 'git-pull-request-closed', review: 'message-square-text', commit: 'git-commit-horizontal', achievement: 'award' };
  const FEED_VERB = { pr_merged: 'Merged', pr_opened: 'Opened', pr_closed: 'Closed', review: 'Reviewed', commit: 'Committed', achievement: 'Achievement' };
  function feedRow(it) {
    const meta = it.type === 'review' ? `${esc(it.repo)} · by @${esc(it.pr.author)} · ${esc(it.src.state.toLowerCase().replace('_', ' '))}` : it.type === 'achievement' ? esc(cap(it.src.category)) : esc(it.repo || '');
    return `<button class="list-item" data-action="open-item" data-id="${it.id}"><span class="feed-ico">${icon(FEED_ICON[it.type])}</span><span class="stack minw0 spacer"><span class="truncate"><span class="muted">${FEED_VERB[it.type]}</span> ${esc(it.title)}</span><span class="caption subtle truncate">${meta}</span></span><span class="caption subtle num" style="white-space:nowrap">${it.t > TODAY - DAY ? time(it.t) : DI.fmtDate(it.t, false)}</span></button>`;
  }
  const shortRef = (ref) => { const m = /^(PR|REV|C|ACH)-(?:[^/]+\/)?(.+)$/.exec(ref || ''); if (!m) return ref; if (m[1] === 'ACH') return 'Achievement'; if (m[1] === 'REV') return 'Review · ' + m[2].replace('#', ' #'); if (m[1] === 'C') return m[2].replace('@', ' @'); return m[2].replace('#', ' #'); };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function feedCard() {
    const items = DI.FEED.filter((i) => i.type !== 'commit' && i.type !== 'pr_opened').slice(0, 7);
    return `<section class="card" aria-labelledby="feed-h"><div class="card-head"><h2 id="feed-h">Recent activity</h2><span class="spacer"></span><a class="btn btn-sm btn-ghost" href="#activity">View all</a></div><div style="padding-top:8px">${items.map(feedRow).join('')}</div></section>`;
  }
  function nextBestAction(p, m) {
    let a;
    if (S.scenario === 'needs-reauth') a = { ic: 'plug', t: 'Reconnect GitHub', d: 'New work since Nov 8 is not being imported.', cta: ['Reconnect', 'reconnect'], why: 'Shown because GitHub access was revoked.' };
    else if (S.scenario === 'sync-failed') a = { ic: 'circle-alert', t: 'Review the failed sync', d: 'One repository returned an error during the last sync.', cta: ['View details', 'go:account-integrations'], why: 'Shown because the last sync failed.' };
    else {
      const half = DI.period('half:2026-H2'); const hm = DI.metrics(half); const daysLeft = Math.round((half.endEx - TODAY) / DAY);
      const hasAppraisal = S.docs.some((d) => d.type === 'appraisal' && d.period === 'half:2026-H2');
      if (!hasAppraisal && daysLeft <= 60) a = { ic: 'file-text', t: 'Start your H2 2026 appraisal', d: `Since July you've merged ${hm.prs_merged.value} PRs and reviewed ${hm.prs_reviewed.value}. H2 ends in ${daysLeft} days — draft now with the evidence so far and refine it later.`, cta: ['Draft appraisal', 'go:new-appraisal'], why: `Shown because H2 ends in ${daysLeft} days and you have no H2 appraisal yet.` };
      else a = { ic: 'award', t: 'Capture a recent win', d: 'Turn your largest merged PR into an achievement while the details are fresh.', cta: ['Add achievement', 'cmdk-achievement'], why: 'Shown because you have no achievements in the last 30 days.' };
    }
    const [label, act] = a.cta; const isGo = act.startsWith('go:');
    return `<section class="card" aria-labelledby="nba-h"><div class="card-head"><h2 id="nba-h">Next step</h2></div><div class="card-body stack-3"><div class="row" style="align-items:flex-start;gap:12px"><span class="feed-ico" style="background:var(--accent);color:var(--accent-foreground)">${icon(a.ic)}</span><span class="stack"><b style="font-weight:600">${a.t}</b><span class="muted small">${a.d}</span></span></div><div class="row-wrap">${isGo ? `<a class="btn btn-primary btn-sm" href="#${act.slice(3)}">${label}</a>` : `<button class="btn btn-primary btn-sm" data-action="${act}">${label}</button>`}<button class="btn btn-ghost btn-sm" data-action="dismiss-nba">Not now</button></div><span class="caption subtle">${a.why}</span></div></section>`;
  }
  function quickActions() {
    return `<section class="card" aria-labelledby="qa-h"><div class="card-head"><h2 id="qa-h">Create</h2></div><div style="padding-top:6px">${[['new-appraisal', 'file-text', 'Appraisal', 'Self-review for a month, quarter, half or year'], ['new-promotion', 'trending-up', 'Promotion packet', 'Your case for the next level, with evidence'], ['new-resume', 'list-checks', 'Resume bullets', 'Quantified bullets for a role']].map(([r, ic, t, d]) => `<a class="list-item" href="#${r}"><span class="feed-ico">${icon(ic)}</span><span class="stack minw0 spacer"><span style="font-weight:500">${t}</span><span class="caption subtle">${d}</span></span>${icon('chevron-right')}</a>`).join('')}</div></section>`;
  }

  // ------------------------------------------------------------------ KPIs
  const SECTIONS = [['delivery', 'Delivery', 'How steadily your own work reaches production.'], ['quality', 'Quality', 'Habits that make changes easy to review and safe to ship.'], ['collaboration', 'Collaboration', "How you support teammates' work through reviews."], ['ownership', 'Ownership', 'Where you both ship and review — shared ownership of code.'], ['consistency', 'Consistency', 'Steadiness over the period. Shown for reflection; mostly not scored.']];
  function vKpis() {
    const gate = stateGate('your KPIs'); if (gate) return pageHead('KPIs') + gate;
    const p = P(), pv = DI.previous(p), m = DI.metrics(p), mp = DI.metrics(pv), imp = DI.impact(p);
    const months = DI.lastMonths(6, Math.min(p.cutoff - 1, TODAY)); const mm = months.map((s) => DI.metrics(DI.period(s)));
    const dimScore = (k) => { const d = imp.dims.find((x) => x.key === k); return d && imp.status === 'ok' && d.score != null ? DI.roundHalfUp(d.score) : null; };
    return `${banners()}${pageHead('KPIs', `${esc(p.label)}${p.inProgress ? ' · in progress' : ''} · <span class="mono">metrics@2.0.0</span> · Only included repositories count`, `<a class="btn" href="#impact">${icon('gauge')}Impact score ${imp.status === 'ok' ? `<b>${imp.overall}</b>` : ''}</a>`)}
      <nav class="tabs" aria-label="KPI sections" style="margin-bottom:16px">${SECTIONS.map(([k, t]) => `<a href="#kpis" data-action="jump" data-to="sec-${k}">${t}</a>`).join('')}</nav>
      <div class="stack-4">${SECTIONS.map(([k, t, d]) => {
        const defs = DI.DEFS.filter((x) => x.section === k);
        const ds = dimScore(k);
        return `<section class="card" id="sec-${k}" aria-labelledby="sh-${k}"><div class="section-head"><div class="stack"><h2 id="sh-${k}">${t}</h2><span class="small muted">${d}</span></div>${k !== 'consistency' ? `<div class="section-score"><span class="small muted">${t} score</span><b>${ds == null ? '—' : ds}</b><span class="caption subtle">weight ${Math.round(DI.DIMS.find((x) => x.key === k).weight * 100)}%</span></div>` : '<div class="section-score"><span class="caption subtle">Active weeks feeds Delivery</span></div>'}</div>
          <div role="list">${defs.map((def) => metricRow(def, m[def.key], mp[def.key], mm.map((x) => x[def.key].value), p)).join('')}</div></section>`;
      }).join('')}
      <p class="caption subtle">Durations use business hours (weekends excluded; holidays are not modelled). Volume metrics stop adding to the score beyond healthy levels. Lines of code are never used as a KPI.</p></div>`;
  }
  function metricRow(def, mv, prev, trend, p) {
    const na = mv.status !== 'ok';
    return `<div class="metric-row" role="listitem">
      <div class="minw0"><div class="metric-name">${esc(def.label)}${def.inScore ? '<span class="badge badge-outline" style="height:20px">Scored</span>' : ''}${!na && def.minN && mv.n < def.minN + 3 ? '<span class="badge badge-warning" style="height:20px">Low sample</span>' : ''}</div><div class="metric-def">${esc(def.definition)}</div></div>
      <div>${na ? `<span class="metric-na">Not enough data</span><div class="caption subtle">n = ${mv.n} of ${def.minN} needed</div>` : `<span class="metric-val">${fmtVal(def.key, mv.value)}</span>${def.minN ? `<div class="caption subtle">n = ${mv.n}</div>` : ''}`}</div>
      <div class="m-delta">${na ? '' : deltaHtml(mv.value, prev ? prev.value : null, def.key, { label: p.inProgress ? 'vs same point' : 'vs previous' })}</div>
      <div class="m-spark" title="Last 6 months">${spark(trend)}</div>
      <button class="info-btn" data-action="explain" data-key="${def.key}" aria-label="Explain ${esc(def.label)}">${icon('info')}</button>
    </div>`;
  }
  function explainDrawer(key) {
    const def = DI.DEF[key]; const p = P(); const m = DI.metrics(p)[key];
    const months = DI.lastMonths(6, Math.min(p.cutoff - 1, TODAY)); const rows = months.map((s) => { const pp = DI.period(s); const v = DI.metrics(pp)[key]; return { label: pp.label, short: DI.MON[new Date(pp.start).getUTCMonth()], v: v.value, n: v.n }; });
    const ev = (m.evidence || []).slice(0, 8).map((id) => DI.lookup(id)).filter(Boolean);
    const isHours = def.unit === 'hours', isRatio = def.unit === 'ratio';
    const cRows = rows.map((r) => ({ label: r.label, short: r.short, v: r.v == null ? 0 : isRatio ? Math.round(r.v * 100) : isHours ? Math.round(r.v * 10) / 10 : r.v }));
    return `<div class="drawer-head"><div class="stack spacer"><span class="caption subtle">${cap(def.section)} · ${def.inScore ? 'Scored' : 'Informational — not scored'}</span><h2 id="dlg-title" style="font-size:18px">${esc(def.label)}</h2></div><button class="btn btn-ghost btn-icon" data-action="close" aria-label="Close">${icon('x')}</button></div>
      <div class="drawer-body">
        <p>${esc(def.definition)}</p>
        <div class="grid g-2"><div class="well stack"><span class="caption subtle">${esc(p.label)}</span><span class="metric-val">${m.status === 'ok' ? fmtVal(key, m.value) : '<span class="metric-na">Not enough data</span>'}</span><span class="caption subtle">Sample n = ${m.n}${def.minN ? ` · minimum ${def.minN}` : ''}</span></div><div class="well stack"><span class="caption subtle">Good range</span><span class="small" style="font-weight:500">${esc(def.goodRange)}</span><span class="caption subtle">${def.direction === 'lower_is_better' ? 'Lower is better' : def.direction === 'higher_is_better' ? 'Higher is better, up to a point' : 'Context only'}</span></div></div>
        <div class="stack-2"><h3>Formula</h3><code class="mono well" style="display:block;font-size:12px;white-space:pre-wrap">${esc(def.formula)}</code></div>
        <div class="stack-2"><div class="row"><h3>Last 6 months</h3><span class="spacer"></span>${tableToggle('drawer-' + key)}</div>${chartSlot({ type: 'col', rows: cRows, series: [{ key: 'v', label: def.label + (isRatio ? ' (%)' : isHours ? ' (h)' : ''), color: '--chart-5' }], height: 140, aria: `${def.label} per month for the last 6 months` })}
          <div class="table-wrap" ${S.showTables['drawer-' + key] ? '' : 'hidden'}><table class="table"><thead><tr><th>Month</th><th class="num">Value</th><th class="num">n</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r.label}</td><td class="num">${r.v == null ? '—' : plain(key, r.v)}</td><td class="num">${r.n}</td></tr>`).join('')}</tbody></table></div></div>
        ${def.caveats.length ? `<div class="stack-2"><h3>Keep in mind</h3><ul style="margin:0;padding-left:18px" class="small muted stack">${def.caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
        ${def.antiGaming ? `<div class="stack-2"><h3>Why gaming it doesn't help</h3><p class="small muted">${esc(def.antiGaming)}</p></div>` : ''}
        <div class="stack-2"><div class="row"><h3>Evidence</h3><span class="caption subtle">${(m.evidence || []).length} records</span><span class="spacer"></span>${ev.length ? `<a class="small" href="#activity" data-action="close-go" data-to="activity">Open in Activity</a>` : ''}</div>${ev.length ? `<div>${ev.map((e) => `<div class="evidence-item"><span class="small truncate" style="font-weight:500">${esc(e.title || e.message)}</span><span class="row-wrap"><span class="ref">${esc(e.ref)}</span><span class="caption subtle">${e.mergedAt ? 'merged ' + DI.fmtDate(e.mergedAt) : e.authoredAt ? DI.fmtDate(e.authoredAt) : ''}</span></span></div>`).join('')}</div>` : '<p class="small muted">This metric is computed from counts across your activity; open Activity to see the records.</p>'}</div>
        <p class="caption subtle">metrics@2.0.0 · Times in ${esc(S.settings.tz)} · Excluded repositories are ignored.</p>
      </div>`;
  }

  // ------------------------------------------------------------------ impact detail
  function impactExplanation(p, imp) {
    if (imp.status !== 'ok') return `Not enough activity in ${p.label} to compute a fair score — try a longer period. The score needs at least 7 days and 3 merged or reviewed pull requests.`;
    const d = Object.fromEntries(imp.dims.map((x) => [x.key, x.score == null ? null : DI.roundHalfUp(x.score)]));
    const un = imp.dims.filter((x) => !x.available).map((x) => `${x.label} wasn't scored this period because there wasn't enough data; the other dimensions were re-weighted.`).join(' ');
    return `<p><b>Your impact score: ${imp.overall} (${imp.band})</b> — a summary of signals from your GitHub activity in ${esc(p.label)}, not a judgement of your performance.</p><p>It combines four dimensions: <b>Delivery</b> ${d.delivery ?? '—'} (PRs merged, cycle time, steady weeks), <b>Quality</b> ${d.quality ?? '—'} (small PRs, reverts, merge rate), <b>Collaboration</b> ${d.collaboration ?? '—'} (PRs reviewed, review turnaround, review balance) and <b>Ownership</b> ${d.ownership ?? '—'} (repositories where you both ship and review, breadth). Weights: 30 / 25 / 30 / 15.</p><p>Each metric is compared with fixed reference ranges based on public engineering research — never with other people. Results from small samples are pulled toward the middle, and volume beyond a healthy level earns no extra points. Lines of code are not used.${un ? ' ' + un : ''}</p><p class="caption subtle">Version impact@2.0.0. Only repositories you included are counted.</p>`;
  }
  function vImpact() {
    const gate = stateGate('your impact score'); if (gate) return pageHead('Impact score') + gate;
    const p = P(), imp = DI.impact(p);
    const hist = DI.lastMonths(12).map((s) => { const pp = DI.period(s); const i = DI.impact(pp); return { label: pp.label + (pp.inProgress ? ' (in progress)' : ''), short: DI.MON[new Date(pp.start).getUTCMonth()], value: i.overall, note: i.status !== 'ok' ? 'Not enough activity for a fair score' : i.band }; });
    const fmtComp = (c) => (c.value == null ? '—' : plain(c.metric, c.value));
    return `${banners()}${pageHead('Impact score', `${esc(p.label)}${p.inProgress ? ' · in progress' : ''} · <span class="mono">impact@2.0.0</span>`)}
      <div class="stack-4">
        <div class="grid g-main">
          <section class="card card-pad stack-4" aria-label="Overall score">
            ${imp.status === 'ok' ? `<div class="row" style="align-items:baseline;gap:10px;flex-wrap:wrap"><span class="score score-xl">${imp.overall}</span><span class="score-of">/ 100</span><span class="badge badge-accent">${imp.band}</span></div>` : `<div class="row"><span class="badge">Not enough data</span></div>`}
            <div class="stack-3" style="max-width:68ch">${impactExplanation(p, imp)}</div>
          </section>
          <section class="card" aria-labelledby="hl-h"><div class="card-head"><h2 id="hl-h">Highlights</h2><span class="badge">${icon('sparkles')}AI</span></div><div class="card-body stack-3">${highlightsBody(p, imp)}</div></section>
        </div>
        <section class="card" aria-labelledby="hist-h"><div class="card-head"><h2 id="hist-h">History</h2><span class="meta">Monthly · last 12 months</span><span class="spacer"></span>${tableToggle('hist')}</div><div class="card-body">${chartSlot({ type: 'line', points: hist, max: 100, ticks: [0, 40, 60, 80, 100], seriesLabel: 'Impact score', height: 200, aria: 'Line chart of monthly impact score over the last 12 months, scale 0 to 100. Months without enough data are gaps.' })}
          <div class="table-wrap" ${S.showTables.hist ? '' : 'hidden'}><table class="table"><thead><tr><th>Month</th><th class="num">Score</th><th>Band</th></tr></thead><tbody>${hist.map((h) => `<tr><td>${esc(h.label)}</td><td class="num">${h.value ?? '—'}</td><td>${esc(h.note)}</td></tr>`).join('')}</tbody></table></div></div></section>
        <div class="grid g-2">${imp.dims.map((d) => `<section class="card" aria-labelledby="dim-${d.key}"><div class="section-head"><div class="stack"><h2 id="dim-${d.key}">${d.label}</h2><span class="small muted">${d.summary} · weight ${Math.round(d.weight * 100)}%</span></div><div class="section-score"><b>${d.score == null || imp.status !== 'ok' ? '—' : DI.roundHalfUp(d.score)}</b></div></div>
          <div class="table-wrap"><table class="table"><caption class="sr-only">${d.label} components</caption><thead><tr><th>Metric</th><th class="num">Value</th><th class="num">n</th><th class="num">Band</th><th class="num">Adjusted</th><th class="num">Weight</th></tr></thead><tbody>${d.comps.map((c) => `<tr><td><button class="link-btn" style="font-weight:400;text-align:left" data-action="explain" data-key="${c.metric}">${esc(DI.DEF[c.metric].label)}</button>${c.per28 ? '<div class="caption subtle">per 4 weeks</div>' : ''}</td><td class="num">${fmtComp(c)}</td><td class="num">${c.n}</td><td class="num">${c.bandScore == null ? '—' : c.bandScore.toFixed(1)}</td><td class="num">${c.shrunkScore == null ? (c.available ? '<span class="subtle">no shrink</span>' : '—') : c.shrunkScore.toFixed(1)}</td><td class="num">${c.available ? Math.round(c.effWeight * 100) + '%' : '<span class="subtle">dropped</span>'}</td></tr>`).join('')}</tbody></table></div></section>`).join('')}</div>
        <p class="caption subtle">"Adjusted" pulls small samples toward 50 (k = 3). A component without enough data is dropped and the others in its dimension are re-weighted. Bands: 0–39 Low signal · 40–59 Moderate · 60–79 Strong · 80–100 Very strong.</p>
      </div>`;
  }
  function highlightsBody(p, imp) {
    if (imp.status !== 'ok') return `<p class="small muted">Highlights need an impact score for the period.</p>`;
    const h = S.highlights && S.highlights.spec === p.spec ? S.highlights : null;
    if (!h) return `<p class="small muted">Get a short narrative of what drove this score, with links to the pull requests behind it. Numbers always come from the metrics engine.</p><div class="row-wrap"><button class="btn btn-sm" data-action="gen-highlights" ${S.scenario === 'quota' ? 'disabled' : ''}>${icon('sparkles')}Generate highlights</button><span class="caption subtle">Uses 1 of 100 quick AI actions</span></div>`;
    if (h.loading) return `<div class="stack-2" aria-busy="true">${sk('90%', 12)}${sk('80%', 12)}${sk('85%', 12)}<span class="caption subtle" role="status">Writing highlights…</span></div>`;
    const top = DI.metrics(p).prs_merged.evidence.slice(0, 3).map((id) => DI.lookup(id));
    return `<ul class="small" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:8px"><li>Delivery stayed steady: most merged PRs were reviewed and merged within two working days, led by ${top[0] ? `“${esc(top[0].title)}” <button class="ref" data-action="cite" data-id="${top[0].id}">${esc(top[0].ref)}</button>` : 'your recent work'}.</li><li>Reviews outnumbered your own merged PRs, spreading knowledge across ${DI.metrics(p).repos_reviewed.value} repositories.</li>${top[1] ? `<li>Kept changes small and reviewable, e.g. <button class="ref" data-action="cite" data-id="${top[1].id}">${esc(top[1].ref)}</button>.</li>` : ''}</ul><div class="row-wrap"><span class="caption subtle">Generated ${time(TODAY)} · cached for this period</span><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-action="gen-highlights">${icon('rotate-cw')}Regenerate</button></div>`;
  }

  // ------------------------------------------------------------------ activity explorer
  function vActivity() {
    const gate = stateGate('your activity', 'list'); if (gate) return pageHead('Activity') + gate;
    const p = P(); const f = S.act;
    const types = [['all', 'All'], ['prs', 'Pull requests'], ['review', 'Reviews'], ['commit', 'Commits'], ['achievement', 'Achievements']];
    let items = DI.FEED.filter((i) => i.t >= p.start && i.t < p.cutoff);
    if (f.type === 'prs') items = items.filter((i) => i.type.startsWith('pr_')); else if (f.type !== 'all') items = items.filter((i) => i.type === f.type);
    if (f.repo !== 'all') items = items.filter((i) => i.repo === f.repo);
    if (f.q) items = items.filter((i) => (i.title + ' ' + i.ref).toLowerCase().includes(f.q.toLowerCase()));
    const shown = items.slice(0, f.shown); let lastDay = ''; let html = '';
    for (const it of shown) { const d = new Date(it.t).toISOString().slice(0, 10); if (d !== lastDay) { html += `<div class="day-head">${dateLong(it.t)}</div>`; lastDay = d; } html += feedRow(it); }
    return `${banners()}${pageHead('Activity', `${esc(p.label)} · ${fmtN(items.length)} items`)}
      <div class="stack-3">
        <div class="row-wrap">
          <div class="row-wrap" role="group" aria-label="Type">${types.map(([k, l]) => `<button class="chip" aria-pressed="${f.type === k}" data-action="act-type" data-v="${k}">${l}</button>`).join('')}</div>
          <span class="spacer"></span>
          <label class="sr-only" for="act-repo">Repository</label><select class="select" id="act-repo" style="width:auto;min-width:200px" data-change="act-repo"><option value="all">All repositories</option>${DI.REPOS.map((r) => `<option ${f.repo === r.name ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
          <div class="input-icon" style="min-width:220px;flex:1;max-width:320px">${icon('search')}<label class="sr-only" for="act-q">Search activity</label><input class="input" id="act-q" type="search" placeholder="Search titles or refs" value="${esc(f.q)}" data-input="act-q"></div>
        </div>
        <div class="card">${shown.length ? html : `<div class="empty"><div class="e-ico">${icon('search-x')}</div><h2>No activity matches these filters</h2><p>Try another type or repository, or a longer period.</p><div class="e-actions"><button class="btn" data-action="act-clear">Clear filters</button></div></div>`}
          ${items.length > shown.length ? `<div class="card-foot" style="justify-content:center"><button class="btn btn-sm" data-action="act-more">Show more</button><span class="caption subtle">${shown.length} of ${items.length}</span></div>` : ''}</div>
      </div>`;
  }
  function itemDrawer(id) {
    const it = DI.FEED.find((i) => i.id === id) || { type: 'achievement', src: S.achievements.find((a) => a.id === id) };
    if (!it || !it.src) return '';
    const head = (kicker, title) => `<div class="drawer-head"><div class="stack spacer minw0"><span class="caption subtle">${kicker}</span><h2 id="dlg-title" style="font-size:17px">${esc(title)}</h2></div><button class="btn btn-ghost btn-icon" data-action="close" aria-label="Close">${icon('x')}</button></div>`;
    if (it.type.startsWith('pr_')) {
      const x = it.src; const ct = x.mergedAt ? DI.businessHours(x.readyAt, x.mergedAt) : null; const fr = x.firstReviewAt ? DI.businessHours(x.readyAt, x.firstReviewAt) : null;
      return head(`${esc(x.repo)} · Pull request #${x.number}`, x.title) + `<div class="drawer-body">
        <div class="row-wrap">${x.mergedAt ? `<span class="badge badge-accent">${icon('git-merge')}Merged</span>` : x.closedAt ? '<span class="badge">Closed without merging</span>' : '<span class="badge">Open</span>'}${x.reverted ? '<span class="badge badge-warning">Reverted</span>' : ''}${x.labels.map((l) => `<span class="badge badge-outline">${esc(l)}</span>`).join('')}<span class="ref">${esc(x.ref)}</span></div>
        <div class="grid g-2">${[['Cycle time', ct == null ? '—' : ct.toFixed(1) + ' h', 'Ready → merged, business hours'], ['First review after', fr == null ? '—' : fr.toFixed(1) + ' h', 'Your wait for a reviewer'], ['Changed lines', `+${x.additions} −${x.deletions}`, `${x.changedFiles} files · ${x.lines <= 400 ? 'small PR' : 'larger than 400 lines'}`], ['Reviews', `${x.approvals} approval${x.approvals > 1 ? 's' : ''}`, x.changesRequested ? `${x.changesRequested} change request${x.changesRequested > 1 ? 's' : ''}` : 'Approved on first pass']].map(([k, v, d]) => `<div class="well stack"><span class="caption subtle">${k}</span><b class="num">${v}</b><span class="caption subtle">${d}</span></div>`).join('')}</div>
        <div class="stack-2"><h3>Timeline</h3><ul class="list small">${[['Opened', x.createdAt], ['Ready for review', x.readyAt !== x.createdAt ? x.readyAt : null], ['First review', x.firstReviewAt], ['Merged', x.mergedAt], ['Reverted', x.reverted]].filter((e) => e[1]).map(([k, t]) => `<li class="row" style="padding:5px 0"><span class="muted" style="width:130px">${k}</span><span class="num">${DI.fmtDate(t)} · ${time(t)}</span></li>`).join('')}</ul></div>
        <div class="well stack-2"><b style="font-weight:500">Capture this as an achievement</b><span class="small muted">DevImpact drafts a short statement from this PR. You review and edit it before saving.</span><button class="btn btn-sm" style="align-self:flex-start" data-action="ach-from-pr" data-id="${x.id}" ${S.scenario === 'quota' ? 'disabled' : ''}>${icon('sparkles')}Turn into achievement</button></div>
      </div><div class="drawer-foot"><a class="btn" href="${x.url}" target="_blank" rel="noopener">${icon('external-link')}Open on GitHub</a></div>`;
    }
    if (it.type === 'review') {
      const r = it.src, rp = it.pr; const ta = r.requestedAt ? DI.businessHours(r.requestedAt, r.submittedAt) : null;
      return head(`${esc(rp.repo)} · Review of #${rp.number} by @${esc(rp.author)}`, rp.title) + `<div class="drawer-body"><div class="row-wrap"><span class="badge">${esc(r.state.toLowerCase().replace('_', ' '))}</span><span class="ref">${esc(rp.ref)}</span></div>
        <div class="grid g-2">${[['Turnaround', ta == null ? 'No request recorded' : ta.toFixed(1) + ' h', 'Requested → your first review'], ['Comments', r.comments + (r.hasBody ? 1 : 0), 'Including the review summary']].map(([k, v, d]) => `<div class="well stack"><span class="caption subtle">${k}</span><b class="num">${v}</b><span class="caption subtle">${d}</span></div>`).join('')}</div>
        <p class="small muted">DevImpact stores review metadata only. The body of someone else's pull request is never stored.</p></div><div class="drawer-foot"><a class="btn" href="${rp.url}" target="_blank" rel="noopener">${icon('external-link')}Open on GitHub</a></div>`;
    }
    if (it.type === 'commit') {
      const c = it.src;
      return head(`${esc(c.repo)} · Commit`, c.message) + `<div class="drawer-body"><div class="row-wrap"><span class="ref">${esc(c.ref)}</span>${c.prNumber ? `<span class="caption subtle">in PR #${c.prNumber}</span>` : ''}</div><div class="well stack"><span class="caption subtle">Authored</span><b class="num">${DI.fmtDate(c.authoredAt)} · ${time(c.authoredAt)}</b><span class="caption subtle">+${c.additions} −${c.deletions} (context only — never a KPI)</span></div></div><div class="drawer-foot"><a class="btn" href="${c.url}" target="_blank" rel="noopener">${icon('external-link')}Open on GitHub</a></div>`;
    }
    const a = it.src;
    return head(`Achievement · ${cap(a.category)}`, a.title) + `<div class="drawer-body"><p>${esc(a.description)}</p>${a.impact ? `<div class="well stack"><span class="caption subtle">Impact</span><span>${esc(a.impact)}</span></div>` : ''}<div class="row-wrap">${a.evidence.map((id) => `<button class="ref" data-action="cite" data-id="${id}">${esc(DI.lookup(id).ref)}</button>`).join('')}</div><span class="caption subtle">${DI.fmtDate(Date.parse(a.occurredOn))} · cited as <span class="mono">${a.ref}</span> in documents</span></div><div class="drawer-foot"><a class="btn" href="#achievements" data-action="close-go" data-to="achievements">Open in Achievements</a></div>`;
  }

  // ------------------------------------------------------------------ career
  function vCareer() {
    const gate = stateGate('your career timeline'); if (gate) return pageHead('Career') + gate;
    const y = S.career.year; const qNow = Math.floor(new Date(TODAY).getUTCMonth() / 3) + 1;
    const quarters = [4, 3, 2, 1].filter((q) => y < 2026 || q <= qNow).filter((q) => y > 2025 || q === 4);
    const body = quarters.map((q) => {
      const p = DI.period(`quarter:${y}-Q${q}`); const m = DI.metrics(p);
      const merged = DI.prs.filter((x) => x.mergedAt && x.mergedAt >= p.start && x.mergedAt < p.cutoff);
      const revs = DI.reviews.filter((r) => r.submittedAt >= p.start && r.submittedAt < p.cutoff);
      const ach = S.achievements.filter((a) => { const t = Date.parse(a.occurredOn); return t >= p.start && t < p.cutoff; });
      const repos = [...new Set([...merged.map((x) => x.repo), ...revs.map((r) => r.repo)])];
      const largest = merged.slice().sort((a, b) => b.lines - a.lines)[0];
      const milestones = [];
      for (const repo of repos) { const first = DI.prs.filter((x) => x.repo === repo && x.mergedAt).sort((a, b) => a.mergedAt - b.mergedAt)[0]; if (first && first.mergedAt >= p.start && first.mergedAt < p.cutoff) milestones.push({ ic: 'flag', t: `First merged PR in ${repo.split('/')[1]}`, ref: first.ref, d: first.mergedAt }); }
      if (largest) milestones.push({ ic: 'maximize-2', t: `Largest merged PR: ${largest.title}`, ref: largest.ref, d: largest.mergedAt });
      if (m.longest_active_week_streak.value >= 6) milestones.push({ ic: 'calendar-check', t: `${m.longest_active_week_streak.value}-week active streak`, ref: null, d: null });
      const exp = S.career.expanded;
      return `<div class="quarter"><div class="q-label"><b>Q${q} ${y}</b><span class="caption subtle">${p.inProgress ? 'In progress' : `${DI.MON[new Date(p.start).getUTCMonth()]}–${DI.MON[new Date(p.endEx - DAY).getUTCMonth()]}`}</span><div class="caption subtle" style="margin-top:6px">${m.prs_merged.value} merged · ${m.prs_reviewed.value} reviewed${ach.length ? ` · ${ach.length} achievement${ach.length > 1 ? 's' : ''}` : ''}</div></div>
        <div class="stack-3 minw0">${milestones.length ? `<div class="grid g-2">${milestones.slice(0, 4).map((ms) => `<div class="milestone">${icon(ms.ic)}<span class="stack minw0"><span class="small" style="font-weight:500">${esc(ms.t)}</span>${ms.ref ? `<span class="caption subtle mono truncate">${esc(ms.ref)}</span>` : ''}</span></div>`).join('')}</div>` : ''}
          ${ach.length ? `<div class="repo-group"><h3>${icon('award')}Beyond code</h3>${ach.map((a) => `<div class="tl-item"><span class="tl-ico">${icon('award')}</span><span class="stack minw0"><span>${esc(a.title)}</span><span class="row-wrap"><span class="badge" style="height:20px">${cap(a.category)}</span><span class="caption subtle">${DI.fmtDate(Date.parse(a.occurredOn), false)}</span></span></span></div>`).join('')}</div>` : ''}
          ${repos.map((repo) => { const key = `${y}${q}${repo}`; const prsR = merged.filter((x) => x.repo === repo); const rv = new Set(revs.filter((r) => r.repo === repo).map((r) => r.prId)).size; const lim = exp[key] ? 50 : 3; return `<div class="repo-group"><h3>${icon('folder-git-2')}${esc(repo)}</h3>${prsR.slice(0, lim).map((x) => `<div class="tl-item"><span class="tl-ico">${icon('git-merge')}</span><span class="stack minw0"><button class="link-btn" style="color:var(--foreground);font-weight:400;text-decoration:none;text-align:left" data-action="open-item" data-id="m-${x.id}">${esc(x.title)}</button><span class="row-wrap">${x.labels.slice(0, 3).map((l) => `<span class="badge badge-outline" style="height:20px">${esc(l)}</span>`).join('')}<span class="caption subtle">#${x.number} · ${DI.fmtDate(x.mergedAt, false)}</span></span></span></div>`).join('')}${prsR.length > lim ? `<button class="link-btn small" style="margin-left:26px" data-action="career-more" data-key="${esc(key)}">Show ${prsR.length - lim} more</button>` : ''}${rv ? `<div class="tl-item"><span class="tl-ico">${icon('message-square-text')}</span><span class="muted">Reviewed ${rv} pull request${rv > 1 ? 's' : ''} by teammates</span></div>` : ''}</div>`; }).join('')}
          ${!repos.length && !ach.length ? '<p class="muted small">No merged work or reviews this quarter.</p>' : ''}
        </div></div>`;
    }).join('');
    return `${pageHead('Career', 'Your work by quarter: merged pull requests, reviews, milestones and achievements.', `<div class="row-wrap"><div class="seg" role="radiogroup" aria-label="Year">${[2026, 2025].map((yy) => `<button role="radio" aria-checked="${y === yy}" data-action="career-year" data-v="${yy}">${yy}</button>`).join('')}</div><button class="btn" data-action="print-view">${icon('printer')}Print view</button></div>`)}<div class="card card-pad">${body}</div>`;
  }

  // ------------------------------------------------------------------ documents
  const curDoc = () => S.docs.find((d) => d.id === S.currentDoc);
  function vDocuments() {
    if (S.scenario === 'loading') return pageHead('Documents') + skeletonPage('list');
    if (S.scenario === 'error') return pageHead('Documents') + errorPanel('your documents');
    const f = S.docsFilter; let docs = S.docs.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    if (S.scenario === 'first-run') docs = [];
    if (f.type !== 'all') docs = docs.filter((d) => d.type === f.type);
    if (f.q) docs = docs.filter((d) => d.title.toLowerCase().includes(f.q.toLowerCase()));
    const newBtn = `<a class="btn btn-primary" href="#new-document">${icon('plus')}New document</a>`;
    if (!S.docs.length || S.scenario === 'first-run') return pageHead('Documents', '', newBtn) + `<div class="card"><div class="empty"><div class="e-ico">${icon('file-text')}</div><h2>No documents yet</h2><p>${S.scenario === 'first-run' ? 'Connect GitHub first — documents are written from your real pull requests and reviews.' : 'Draft an appraisal, promotion packet or resume bullets. Every claim links to the work behind it.'}</p><div class="e-actions">${S.scenario === 'first-run' ? '<a class="btn btn-primary" href="#onboarding-connect">Connect GitHub</a>' : newBtn}</div></div></div>`;
    return `${pageHead('Documents', `${S.docs.length} documents · drafts are saved automatically`, newBtn)}
      <div class="stack-3"><div class="row-wrap"><div class="row-wrap" role="group" aria-label="Type">${[['all', 'All'], ['appraisal', 'Appraisals'], ['promotion', 'Promotion'], ['resume', 'Resume']].map(([k, l]) => `<button class="chip" aria-pressed="${f.type === k}" data-action="doc-type" data-v="${k}">${l}</button>`).join('')}</div><span class="spacer"></span><div class="input-icon" style="min-width:220px">${icon('search')}<label class="sr-only" for="doc-q">Search documents</label><input class="input" id="doc-q" type="search" placeholder="Search documents" value="${esc(f.q)}" data-input="doc-q"></div></div>
      <div class="card table-wrap">${docs.length ? `<table class="table responsive"><caption class="sr-only">Documents</caption><thead><tr><th>Title</th><th>Type</th><th>Period</th><th class="num">Version</th><th class="num">Evidence</th><th>Updated</th></tr></thead><tbody>${docs.map((d) => `<tr class="clickable" data-action="open-doc" data-id="${d.id}"><td style="min-width:0"><a href="#document" data-action="open-doc" data-id="${d.id}" style="color:var(--foreground);text-decoration:none;font-weight:500">${esc(d.title)}</a> ${d.status !== 'ready' ? statusBadge[d.status] : ''}${d.flags.uncited ? ` <span class="badge badge-warning">${d.flags.uncited} uncited</span>` : ''}</td><td><span class="badge">${typeLabel[d.type]}</span></td><td class="muted">${esc(DI.period(d.period).label)}</td><td class="num">v${d.version}</td><td class="num">${d.coverage == null ? '—' : Math.round(d.coverage * 100) + '% cited'}</td><td class="muted">${DI.fmtDate(d.updatedAt, false)}</td></tr>`).join('')}</tbody></table>` : `<div class="empty"><div class="e-ico">${icon('search-x')}</div><h2>No documents match</h2><p>Try another type or search term.</p><div class="e-actions"><button class="btn" data-action="doc-clear">Clear filters</button></div></div>`}</div></div>`;
  }
  function vNewDocument() {
    return pageHead('New document', 'Pick what you need. You can edit, regenerate and export every document.') + `<div class="grid g-3">${[['new-appraisal', 'file-text', 'Appraisal', 'A self-review for a month, quarter, half-year, year or custom range. Metrics tables are filled by DevImpact, not the AI.'], ['new-promotion', 'trending-up', 'Promotion packet', 'Your case for the next level, structured around scope, impact and leadership, with evidence links.'], ['new-resume', 'list-checks', 'Resume bullets', '5–8 quantified bullets tailored to a role, optionally to a job description.']].map(([r, ic, t, d]) => `<a class="card card-pad stack-3" href="#${r}" style="text-decoration:none;color:inherit"><span class="feed-ico" style="background:var(--accent);color:var(--accent-foreground)">${icon(ic)}</span><b style="font-size:15px">${t}</b><span class="small muted">${d}</span><span class="small" style="color:var(--link);font-weight:500">Start ${t.toLowerCase()} ${icon('arrow-right')}</span></a>`).join('')}</div>`;
  }
  function studio(type) {
    const gate = S.scenario === 'first-run' ? emptyNoIntegration('Connect GitHub to write documents from your work') : S.scenario === 'error' ? errorPanel('the document studio') : null;
    const title = { resume: 'New resume bullets', appraisal: 'New appraisal', promotion: 'New promotion packet' }[type];
    if (gate) return pageHead(title) + gate;
    const st = S.studio || (S.studio = {});
    const spec = st[type + 'Period'] || (type === 'appraisal' ? 'half:2026-H2' : 'custom:2025-11-09..2026-11-08');
    const p = DI.period(spec); const m = DI.metrics(p);
    const quota = S.scenario === 'quota';
    const periodField = type === 'appraisal'
      ? `<div class="field"><label class="label" for="st-period">Period</label><select class="select" id="st-period" data-change="studio-period" data-type="${type}">${[['month:2026-10', 'October 2026'], ['month:2026-11', 'November 2026 (in progress)'], ['quarter:2026-Q3', 'Q3 2026'], ['quarter:2026-Q4', 'Q4 2026 (in progress)'], ['half:2026-H1', 'H1 2026 (Jan–Jun)'], ['half:2026-H2', 'H2 2026 (Jul–Dec, in progress)'], ['year:2025', '2025'], ['custom:2025-11-09..2026-11-08', 'Last 12 months']].map(([v, l]) => `<option value="${v}" ${spec === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${p.inProgress ? '<span class="help">In-progress period: the draft covers work up to today.</span>' : ''}</div>`
      : `<div class="field"><label class="label" for="st-period">Period</label><select class="select" id="st-period" data-change="studio-period" data-type="${type}">${[['custom:2025-11-09..2026-11-08', 'Last 12 months'], ['half:2026-H2', 'H2 2026'], ['year:2026', '2026 so far'], ['year:2025', '2025']].map(([v, l]) => `<option value="${v}" ${spec === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
    let fields = '';
    if (type === 'resume') fields = `<fieldset class="field" style="border:0;padding:0;margin:0"><legend class="label" style="margin-bottom:6px">Role</legend><div class="seg" role="radiogroup" aria-label="Role">${['Backend', 'Frontend', 'Fullstack', 'DevOps', 'Manager'].map((r, i) => `<button type="button" role="radio" aria-checked="${(st.role || 'Backend') === r}" data-action="studio-role" data-v="${r}">${r}</button>`).join('')}</div></fieldset>
      <div class="grid g-2"><fieldset class="field" style="border:0;padding:0;margin:0"><legend class="label" style="margin-bottom:6px">Format</legend><div class="seg" role="radiogroup"><button type="button" role="radio" aria-checked="true">Bullets</button><button type="button" role="radio" aria-checked="false">Narrative</button></div></fieldset><fieldset class="field" style="border:0;padding:0;margin:0"><legend class="label" style="margin-bottom:6px">Length</legend><div class="seg" role="radiogroup"><button type="button" role="radio" aria-checked="false">Short</button><button type="button" role="radio" aria-checked="true">Standard</button></div></fieldset></div>
      <div class="field"><label class="label" for="st-jd">Job description <span class="subtle" style="font-weight:400">(optional)</span></label><textarea class="textarea" id="st-jd" placeholder="Paste a job posting to tailor the bullets to it"></textarea><span class="help">Up to 8,000 characters. Never stored with your profile.</span></div>`;
    if (type === 'appraisal') fields = `<div class="field"><label class="label" for="st-notes">Self-reflection notes <span class="subtle" style="font-weight:400">(optional)</span></label><textarea class="textarea" id="st-notes" placeholder="What are you proudest of? What would you do differently? Anything GitHub can't show?"></textarea><span class="help">Used to shape the narrative. Up to 4,000 characters.</span></div>`;
    if (type === 'promotion') fields = `<div class="grid g-2"><div class="field"><label class="label" for="st-cur">Current role</label><input class="input" id="st-cur" value="${esc(S.settings.role)}" required></div><div class="field"><label class="label" for="st-tgt">Target role</label><input class="input" id="st-tgt" value="${esc(S.settings.target)}" required aria-describedby="st-tgt-err"><span class="error-text" id="st-tgt-err" hidden>${icon('circle-alert')}Enter the role you're aiming for</span></div></div>
      <div class="field"><label class="label" for="st-ladder">Career ladder or expectations <span class="subtle" style="font-weight:400">(optional)</span></label><textarea class="textarea" id="st-ladder" placeholder="Paste your company's expectations for the target level"></textarea><span class="help">Sections are mapped to these expectations when provided.</span></div>`;
    const top = m.prs_merged.evidence.map((id) => DI.lookup(id)).sort((a, b) => b.lines - a.lines).slice(0, 5);
    const achN = S.achievements.filter((a) => { const t = Date.parse(a.occurredOn); return t >= p.start && t < p.cutoff; }).length;
    return `${pageHead(title)}
      <div class="grid g-side" style="align-items:start">
        <form class="card" id="studio-form" data-type="${type}" novalidate><div class="card-body stack-4" style="padding-top:16px">${periodField}${fields}</div>
          <div class="card-foot" style="flex-wrap:wrap">${quota ? `<span class="small" style="color:var(--warning);display:flex;gap:6px;align-items:center">${icon('circle-alert')}You've used all 15 generations for November. They reset on December 1.</span><span class="spacer"></span><a class="btn btn-sm" href="#account-plan">See plan</a>` : `<span class="caption subtle">Uses 1 of ${15 - S.usage.gen} generations left this month · same inputs reuse the last result for free</span><span class="spacer"></span>`}<button class="btn btn-primary" type="submit" ${quota ? 'disabled' : ''}>${icon('sparkles')}Generate</button></div></form>
        <aside class="card" aria-labelledby="ev-h"><div class="card-head"><h2 id="ev-h">Evidence preview</h2><span class="meta">${esc(p.label)}</span></div><div class="card-body stack-3">
          <div class="grid g-2" style="gap:8px">${[['PRs merged', m.prs_merged.value], ['PRs reviewed', m.prs_reviewed.value], ['Repositories', m.repos_contributed.value], ['Achievements', achN]].map(([k, v]) => `<div class="well stack" style="padding:10px"><span class="caption subtle">${k}</span><b class="num" style="font-size:18px">${v}</b></div>`).join('')}</div>
          ${m.prs_merged.value + m.prs_reviewed.value === 0 ? `<div class="banner banner-warning" style="margin:0"><span class="b-ico">${icon('triangle-alert')}</span><div class="b-body"><span class="b-title">Not enough evidence</span><span class="small muted">There's no merged or reviewed work in this period. Choose a longer period.</span></div></div>` : ''}
          <div class="stack-2"><h3>Most significant work</h3>${top.map((x) => `<div class="stack" style="gap:2px"><span class="small truncate">${esc(x.title)}</span><span class="caption subtle mono truncate">${esc(x.ref)}</span></div>`).join('')}</div>
          <p class="caption subtle">Ranked by DevImpact (size, labels, reviews), not by the AI. ${S.settings.redact ? 'Private repository names are redacted from AI input.' : ''}</p>
        </div></aside>
      </div>`;
  }

  // document content built from real evidence
  function buildContent(doc) {
    const p = DI.period(doc.period); const m = DI.metrics(p);
    const merged = m.prs_merged.evidence.map((id) => DI.lookup(id)).sort((a, b) => b.lines - a.lines);
    const revRepos = m.repos_reviewed.value;
    const c = (x) => (x ? `<button class="ref" data-action="cite" data-id="${x.id}" aria-label="Evidence ${esc(x.ref)}">${esc(shortRef(x.ref))}</button>` : '');
    const ach = S.achievements.filter((a) => { const t = Date.parse(a.occurredOn); return t >= p.start && t < p.cutoff; });
    const metricsTable = `<div class="table-wrap"><table class="table"><thead><tr><th>Metric</th><th class="num">${esc(p.label)}</th></tr></thead><tbody>${['prs_merged', 'pr_cycle_time_median_hours', 'prs_reviewed', 'review_turnaround_median_hours', 'small_pr_ratio', 'repos_contributed'].map((k) => `<tr><td>${DI.DEF[k].label}</td><td class="num">${m[k].status === 'ok' ? plain(k, m[k].value) : 'Not enough data'}</td></tr>`).join('')}<tr><td>Impact score</td><td class="num">${DI.impact(p).overall ?? '—'}</td></tr></tbody></table></div><p class="engine-note">${icon('calculator')}Calculated by DevImpact from your GitHub data — not written by AI.</p>`;
    if (doc.type === 'resume') return [
      { key: 'bullets', title: 'Resume bullets — Backend', html: `<ul>${merged.slice(0, 6).map((x, i) => `<li class="claim">${['Shipped', 'Led', 'Built', 'Hardened', 'Reduced', 'Delivered'][i]} ${esc(x.title.charAt(0).toLowerCase() + x.title.slice(1))} in a high-volume payments platform, reviewed by ${x.approvals + 1} engineers ${c(x)}</li>`).join('')}<li class="claim">Reviewed ${m.prs_reviewed.value} pull requests across ${revRepos} repositories, typically within ${plain('review_turnaround_median_hours', m.review_turnaround_median_hours.value)} ${c(DI.reviewedById[m.prs_reviewed.evidence[0]])}</li></ul>` },
    ];
    if (doc.type === 'promotion') return [
      { key: 'summary', title: 'Case summary', html: `<p class="claim">Over ${esc(p.label)}, I owned delivery across ${m.repos_contributed.value} repositories and became a go-to reviewer for the payments domain, merging ${m.prs_merged.value} pull requests and reviewing ${m.prs_reviewed.value} ${c(merged[0])}.</p>` },
      { key: 'scope', title: 'Scope and ownership', html: `<ul>${merged.slice(0, 3).map((x) => `<li class="claim">${esc(x.title)} ${c(x)}</li>`).join('')}</ul>` },
      { key: 'leadership', title: 'Technical leadership', html: `<ul>${ach.filter((a) => ['leadership', 'incident'].includes(a.category)).map((a) => `<li class="claim">${esc(a.title)}. ${esc(a.impact)} <button class="ref" data-action="open-item" data-id="${a.id}" aria-label="Evidence ACH-${a.id}">Achievement</button></li>`).join('') || '<li class="claim">Drove the design of idempotent webhook processing.</li>'}</ul>` },
      { key: 'collab', title: 'Collaboration and mentoring', html: `<p class="claim">Reviewed ${m.prs_reviewed.value} pull requests across ${revRepos} repositories with a median turnaround of ${plain('review_turnaround_median_hours', m.review_turnaround_median_hours.value)}.</p><p class="claim" data-flag="uncited">Regularly unblocked the platform team during on-call handovers. <span class="ref ref-flag" title="No evidence linked">${icon('triangle-alert')}No evidence linked</span></p>` },
      { key: 'metrics', title: 'Evidence summary', html: metricsTable, engine: true },
      { key: 'gaps', title: 'Areas to strengthen', html: `<p class="claim">Broaden influence beyond payments by leading a cross-team design review in the next half.</p>` },
    ];
    return [
      { key: 'summary', title: 'Summary', html: `<p class="claim">In ${esc(p.label)} I focused on the reliability of our payment flows: I merged ${m.prs_merged.value} pull requests across ${m.repos_with_merged_prs.value} repositories and reviewed ${m.prs_reviewed.value} of my teammates' changes ${c(merged[0])}.</p>` },
      { key: 'accomplishments', title: 'Key accomplishments', html: `<ul>${merged.slice(0, 4).map((x) => `<li class="claim">${esc(x.title)}, ${x.lines <= 400 ? 'kept small and easy to review' : 'delivered as a larger, carefully staged change'} ${c(x)}</li>`).join('')}${ach.slice(0, 1).map((a) => `<li class="claim">${esc(a.title)} <button class="ref" data-action="open-item" data-id="${a.id}" aria-label="Evidence ACH-${a.id}">Achievement</button></li>`).join('')}</ul>` },
      { key: 'collaboration', title: 'Collaboration and reviews', html: `<p class="claim">I reviewed ${m.prs_reviewed.value} pull requests in ${revRepos} repositories, usually within ${plain('review_turnaround_median_hours', m.review_turnaround_median_hours.value)} of being asked ${c(DI.reviewedById[m.prs_reviewed.evidence[0]])}.</p>` },
      { key: 'metrics', title: 'Metrics', html: metricsTable, engine: true },
      { key: 'growth', title: 'Growth and next steps', html: `<p class="claim">Next half I want to lead a cross-team design review and keep review turnaround under one working day.</p>` },
    ];
  }
  function vDocument() {
    const doc = curDoc(); if (!doc) return pageHead('Document not found') + `<div class="card"><div class="empty"><h2>This document was deleted</h2><a class="btn" href="#documents">Back to documents</a></div></div>`;
    if (S.scenario === 'error') return errorPanel('this document');
    const g = S.gen && S.gen.docId === doc.id ? S.gen : null;
    const sections = doc.content || (doc.content = buildContent(doc));
    const streaming = g && g.status === 'streaming';
    const shownSections = streaming ? sections.slice(0, g.index + 1) : g && g.status === 'cancelled' ? sections.slice(0, g.index) : sections;
    const p = DI.period(doc.period);
    const editing = S.docEdit && !streaming;
    const cited = (doc.content || []).flatMap((s) => [...s.html.matchAll(/data-id="([a-z0-9]+)"/g)].map((x) => x[1])).filter((v, i, a) => a.indexOf(v) === i).map((id) => DI.lookup(id) || S.achievements.find((a) => a.id === id)).filter(Boolean);
    const statusLine = streaming ? `<div class="banner banner-info" role="status" aria-live="polite"><span class="b-ico">${icon('loader-circle', 'spin')}</span><div class="b-body"><span class="b-title">Writing section ${g.index + 1} of ${sections.length} · ${esc(sections[g.index].title)}</span><span class="muted small">You can leave this page — the draft keeps generating and appears in Documents.</span></div><div class="b-actions"><button class="btn btn-sm" data-action="cancel-gen">Stop</button></div></div>`
      : g && g.status === 'cancelled' ? `<div class="banner" role="status"><span class="b-ico">${icon('circle-stop')}</span><div class="b-body"><span class="b-title">Generation stopped</span><span class="muted small">Nothing was counted against your quota. The partial draft below is not saved.</span></div><div class="b-actions"><button class="btn btn-sm btn-primary" data-action="regen">Generate again</button></div></div>`
      : g && g.status === 'failed' ? `<div class="banner banner-danger" role="alert"><span class="b-ico">${icon('circle-alert')}</span><div class="b-body"><span class="b-title">The draft couldn't be finished</span><span class="muted small">The AI service was overloaded. Nothing was counted against your quota.</span></div><div class="b-actions"><button class="btn btn-sm btn-primary" data-action="regen">Try again</button></div></div>` : '';
    return `<div class="doc-head"><div class="stack minw0 spacer"><div class="row-wrap"><span class="badge">${typeLabel[doc.type]}</span><span class="caption subtle">${esc(p.label)} · v${doc.version}${doc.source === 'user_edit' ? ' · edited' : ''} · ${doc.model || 'claude-opus-5-5'}</span>${!streaming && doc.coverage != null ? `<span class="badge ${doc.flags.uncited ? 'badge-warning' : ''}">${Math.round(doc.coverage * 100)}% of claims cited</span>` : ''}</div><h1 style="margin-top:6px">${esc(doc.title)}</h1></div>
        <div class="row-wrap">${editing ? `<span class="caption subtle" role="status" aria-live="polite">${S.docSave === 'saving' ? 'Saving…' : `Saved · v${doc.version}`}</span><button class="btn btn-primary" data-action="doc-edit">Done</button>` : `<button class="btn" data-action="doc-edit" ${streaming ? 'disabled' : ''}>${icon('pencil')}Edit</button><button class="btn" data-action="open-regen" id="regen-btn" aria-haspopup="menu" ${streaming ? 'disabled' : ''}>${icon('rotate-cw')}Regenerate</button><button class="btn btn-primary" data-action="open-export" id="export-btn" aria-haspopup="menu" ${streaming ? 'disabled' : ''}>${icon('download')}Export</button><button class="btn btn-ghost btn-icon" data-action="open-docmore" id="docmore-btn" aria-label="More actions" aria-haspopup="menu">${icon('ellipsis')}</button>`}</div></div>
      ${statusLine}
      ${doc.flags.uncited && !streaming ? `<div class="banner banner-warning"><span class="b-ico">${icon('triangle-alert')}</span><div class="b-body"><span class="b-title">${doc.flags.uncited} claim has no evidence</span><span class="muted small">Underlined claims aren't backed by a PR, review or achievement. Edit them, link an achievement, or remove them before sharing.</span></div></div>` : ''}
      <div class="grid g-side" style="align-items:start">
        <article class="card card-pad" style="padding:28px 32px" aria-label="Document"><div class="doc">${shownSections.map((s, i) => `<section class="section ${streaming && i === g.index ? 'writing' : ''}" aria-labelledby="sec-h-${s.key}"><h2 id="sec-h-${s.key}">${esc(s.title)}${s.engine ? ' <span class="badge" style="vertical-align:3px">Engine</span>' : ''}</h2><div ${editing && !s.engine ? 'contenteditable="true" data-input="doc-edit" role="textbox" aria-multiline="true" aria-label="' + esc(s.title) + '"' : ''}>${streaming && i === g.index ? partial(s.html, g.chars) + '<span class="caret" aria-hidden="true"></span>' : s.html}</div></section>`).join('')}</div></article>
        <aside class="stack-4">
          <section class="card" aria-labelledby="ev2-h"><div class="card-head"><h2 id="ev2-h">Evidence</h2><span class="meta">${cited.length} cited</span></div><div class="card-body" style="padding-top:6px">${cited.slice(0, 8).map((e) => `<div class="evidence-item"><span class="small truncate">${esc(e.title || e.message)}</span><span class="row-wrap"><button class="ref" data-action="cite" data-id="${e.id}">${esc(e.ref)}</button></span></div>`).join('') || '<p class="small muted">Citations appear as sections are written.</p>'}</div></section>
          <section class="card" aria-labelledby="ver-h"><div class="card-head"><h2 id="ver-h">Versions</h2></div><div style="padding-top:6px">${Array.from({ length: doc.version }, (_, i) => doc.version - i).map((v) => `<div class="list-item"><span class="stack spacer"><span class="small" style="font-weight:500">v${v}${v === doc.version ? ' · current' : ''}</span><span class="caption subtle">${v === 1 ? 'Generated' : v === doc.version && doc.source === 'user_edit' ? 'Your edits' : 'Regenerated'} · ${DI.fmtDate(doc.updatedAt - (doc.version - v) * DAY, false)}</span></span>${v !== doc.version ? `<button class="btn btn-sm btn-ghost" data-action="restore" data-v="${v}">Restore</button>` : ''}</div>`).join('')}</div></section>
        </aside>
      </div>`;
  }
  // Cut the section's HTML after `chars` visible characters; the HTML parser closes any open tags.
  function partial(html, chars) { let n = 0, inTag = false; for (let i = 0; i < html.length; i++) { const ch = html[i]; if (ch === '<') inTag = true; else if (ch === '>') inTag = false; else if (!inTag) { if (n >= chars) return html.slice(0, i); n++; } } return html; }

  // ------------------------------------------------------------------ achievements & goals
  const CATS = ['delivery', 'quality', 'mentoring', 'incident', 'leadership', 'learning', 'collaboration', 'other'];
  function vAchievements() {
    if (S.scenario === 'loading') return pageHead('Achievements') + skeletonPage('list');
    if (S.scenario === 'error') return pageHead('Achievements') + errorPanel('your achievements');
    const list = S.achievements.filter((a) => S.ach.cat === 'all' || a.category === S.ach.cat).sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
    const add = `<button class="btn btn-primary" data-action="add-achievement">${icon('plus')}Add achievement</button>`;
    if (!S.achievements.length) return pageHead('Achievements', '', add) + `<div class="card"><div class="empty"><div class="e-ico">${icon('award')}</div><h2>Capture the work GitHub can't see</h2><p>Mentoring, incidents, design docs, talks. Achievements appear in your timeline and can be cited in documents.</p><div class="e-actions">${add}</div></div></div>`;
    let lastM = ''; let html = '';
    for (const a of list) { const mo = a.occurredOn.slice(0, 7); if (mo !== lastM) { html += `<div class="day-head">${DI.MONTHS[+mo.slice(5) - 1]} ${mo.slice(0, 4)}</div>`; lastM = mo; } html += `<div class="list-item" style="align-items:flex-start"><span class="feed-ico">${icon('award')}</span><div class="stack minw0 spacer"><button class="link-btn" style="color:var(--foreground);text-decoration:none;text-align:left;font-weight:500" data-action="open-item" data-id="${a.id}">${esc(a.title)}</button>${a.impact ? `<span class="small muted">${esc(a.impact)}</span>` : ''}<span class="row-wrap" style="margin-top:4px"><span class="badge" style="height:20px">${cap(a.category)}</span>${a.evidence.map((id) => `<button class="ref" data-action="cite" data-id="${id}">${esc(DI.lookup(id).ref)}</button>`).join('')}${a.links.map((l) => `<a class="caption" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</span></div><span class="caption subtle num">${DI.fmtDate(Date.parse(a.occurredOn), false)}</span><button class="btn btn-ghost btn-icon btn-sm" data-action="del-ach" data-id="${a.id}" aria-label="Delete ${esc(a.title)}">${icon('trash-2')}</button></div>`; }
    return `${pageHead('Achievements', `${S.achievements.length} achievements · cited as evidence in documents and shown in Career`, add)}<div class="stack-3"><div class="row-wrap" role="group" aria-label="Category"><button class="chip" aria-pressed="${S.ach.cat === 'all'}" data-action="ach-cat" data-v="all">All</button>${CATS.map((c) => `<button class="chip" aria-pressed="${S.ach.cat === c}" data-action="ach-cat" data-v="${c}">${cap(c)}</button>`).join('')}</div><div class="card">${list.length ? html : `<div class="empty"><h2>No ${S.ach.cat} achievements yet</h2><div class="e-actions">${add}</div></div>`}</div></div>`;
  }
  function achDialog(pre = {}) {
    return `<div class="dialog-head"><h2 id="dlg-title">${pre.fromPr ? 'Review achievement' : 'Add achievement'}</h2>${pre.fromPr ? `<p class="small muted" style="margin-top:4px">Drafted by AI from <span class="mono">${esc(pre.fromPr)}</span>. Edit anything before saving.</p>` : ''}</div>
      <form class="dialog-body" id="ach-form" novalidate>
        <div class="field"><label class="label" for="af-title">Title</label><input class="input" id="af-title" maxlength="200" value="${esc(pre.title || '')}" placeholder="e.g. Led the checkout incident response" aria-describedby="af-title-err"><span class="error-text" id="af-title-err" hidden>${icon('circle-alert')}Add a short title</span></div>
        <div class="grid g-2"><div class="field"><label class="label" for="af-cat">Category</label><select class="select" id="af-cat">${CATS.map((c) => `<option value="${c}" ${pre.category === c ? 'selected' : ''}>${cap(c)}</option>`).join('')}</select></div><div class="field"><label class="label" for="af-date">Date</label><input class="input" type="date" id="af-date" value="${pre.date || DI.iso(TODAY)}" max="${DI.iso(TODAY)}"></div></div>
        <div class="field"><label class="label" for="af-impact">Impact <span class="subtle" style="font-weight:400">(optional)</span></label><textarea class="textarea" id="af-impact" style="min-height:72px" placeholder="What changed because of this? Numbers help.">${esc(pre.statement || '')}</textarea></div>
        <div class="field"><span class="label">Linked evidence</span><div class="row-wrap">${(pre.evidence || []).map((id) => `<span class="ref">${esc(DI.lookup(id).ref)}</span>`).join('') || '<span class="small muted">None yet.</span>'}<button type="button" class="btn btn-sm btn-ghost" data-action="noop-evidence">${icon('link')}Link PRs or reviews</button></div></div>
      </form>
      <div class="dialog-foot"><button class="btn" data-action="close">Cancel</button><button class="btn btn-primary" data-action="save-ach" data-evidence="${(pre.evidence || []).join(',')}">Save achievement</button></div>`;
  }
  function vGoals() {
    if (S.scenario === 'loading') return pageHead('Goals') + skeletonPage('list');
    if (S.scenario === 'error') return pageHead('Goals') + errorPanel('your goals');
    const evalP = DI.period('month:2026-10'); const m = DI.metrics(evalP);
    const add = `<button class="btn btn-primary" data-action="add-goal">${icon('plus')}Add goal</button>`;
    return `${pageHead('Goals', `Progress is measured on ${evalP.label}, your most recent complete month.`, add)}<div class="grid g-3">${S.goals.map((g) => {
      let status, cur = null; const t = g.metricTarget;
      if (t) { const v = m[t.metricKey]; cur = v.value; status = v.status !== 'ok' ? 'no_data' : (t.comparator === 'lte' ? cur <= t.targetValue : cur >= t.targetValue) ? 'met' : 'not_met'; } else status = 'no_metric';
      const badge = { met: `<span class="badge badge-success">${icon('circle-check')}On target</span>`, not_met: `<span class="badge badge-warning">${icon('circle-dot')}Not yet</span>`, no_data: '<span class="badge">Not enough data</span>', no_metric: '<span class="badge badge-outline">Tracked by achievements</span>' }[status];
      const tgt = t ? `${DI.DEF[t.metricKey].label} ${t.comparator === 'lte' ? '≤' : '≥'} ${plain(t.metricKey, t.targetValue)}` : `${g.achievementIds.length} linked achievement${g.achievementIds.length === 1 ? '' : 's'}`;
      const pct = t && cur != null ? Math.max(0, Math.min(100, t.comparator === 'gte' ? (cur / t.targetValue) * 100 : (t.targetValue / Math.max(cur, 0.01)) * 100)) : g.achievementIds.length * 50;
      return `<section class="card card-pad stack-3"><div class="row" style="align-items:flex-start"><b style="font-weight:600" class="spacer">${esc(g.title)}</b></div>${badge}<div class="stack"><span class="small muted">${esc(tgt)}</span>${t ? `<span class="metric-val">${cur == null ? '—' : fmtVal(t.metricKey, cur)} <span class="caption subtle" style="font-weight:400">now</span></span>` : ''}</div><div class="progress" aria-hidden="true"><span style="width:${pct}%"></span></div><span class="caption subtle">${DI.fmtDate(Date.parse(g.startDate), false)} – ${DI.fmtDate(Date.parse(g.targetDate))}</span></section>`;
    }).join('')}</div>`;
  }
  function goalDialog() {
    return `<div class="dialog-head"><h2 id="dlg-title">Add goal</h2></div><form class="dialog-body" novalidate>
      <div class="field"><label class="label" for="gf-title">Goal</label><input class="input" id="gf-title" placeholder="e.g. Review teammates' PRs within a day"></div>
      <div class="field"><label class="label" for="gf-metric">Measure with a metric <span class="subtle" style="font-weight:400">(optional)</span></label><select class="select" id="gf-metric"><option value="">No metric — track with achievements</option>${DI.DEFS.filter((d) => d.unit !== 'count' || d.inScore).map((d) => `<option value="${d.key}">${d.label}</option>`).join('')}</select><span class="help">Progress is checked against your most recent complete month.</span></div>
      <div class="grid g-2"><div class="field"><label class="label" for="gf-cmp">Target</label><select class="select" id="gf-cmp"><option>At most</option><option>At least</option></select></div><div class="field"><label class="label" for="gf-val">Value</label><input class="input" id="gf-val" inputmode="decimal" placeholder="8"></div></div>
      <div class="field"><label class="label" for="gf-date">Target date</label><input class="input" type="date" id="gf-date" value="2026-12-31"></div></form>
      <div class="dialog-foot"><button class="btn" data-action="close">Cancel</button><button class="btn btn-primary" data-action="save-goal">Add goal</button></div>`;
  }

  // ------------------------------------------------------------------ settings
  function settingsWrap(title, lede, inner) { return `<div style="max-width:760px">${pageHead(title, lede)}${inner}</div>`; }
  function vIntegrations() {
    if (S.scenario === 'loading') return settingsWrap('Integrations', '', skeletonPage('list'));
    const st = { 'needs-reauth': ['badge-warning', 'Needs reconnection', 'GitHub access was revoked on Nov 8. Reconnect to resume syncing — nothing has been deleted.'], 'sync-failed': ['badge-danger', 'Last sync failed', 'Reviews from harbor-io/ledger-service could not be imported at 09:14.'], 'rate-limited': ['badge-warning', 'Paused until 16:32', "GitHub's rate limit was reached. The sync resumes automatically."], syncing: ['badge-accent', 'Importing history · 64%', 'Your last 30 days are ready; Jan–Sep 2026 is still loading.'] }[S.scenario] || ['badge-success', 'Connected', 'Synced 12 min ago · next scheduled sync tomorrow at 03:40'];
    const connected = S.scenario !== 'first-run';
    const repoRows = S.repos.map((r) => `<li class="list-item"><button class="switch" role="switch" aria-checked="${r.included}" data-action="toggle-repo" data-id="${r.id}" aria-label="Include ${esc(r.name)}"></button><span class="stack minw0 spacer"><span class="truncate" style="font-weight:500">${esc(r.name)}</span><span class="caption subtle">${r.included ? 'Counted in KPIs and documents' : 'Excluded — data kept, never counted'} · last activity ${rel(r.lastActivity)}</span></span>${r.private ? `<span class="badge hide-sm">${icon('lock')}Private</span>` : ''}</li>`).join('');
    return settingsWrap('Integrations', 'Where DevImpact gets your engineering activity.', `<div class="stack-4">
      ${banners()}
      <section class="card" aria-labelledby="gh-h"><div class="card-head" style="padding-bottom:12px"><span class="feed-ico">${icon('github')}</span><div class="stack spacer"><h2 id="gh-h">GitHub</h2>${connected ? `<span class="caption subtle">@${DI.USER.login} · via GitHub App (read-only)</span>` : '<span class="caption subtle">Pull requests, reviews and commits</span>'}</div>${connected ? `<span class="badge ${st[0]}">${st[1]}</span>` : ''}</div>
        <div class="card-body stack-3">${connected ? `<p class="small muted">${st[2]}</p>
          <div class="table-wrap"><table class="table"><thead><tr><th>Installed on</th><th>Repositories</th><th>Status</th></tr></thead><tbody><tr><td>@priyar <span class="caption subtle">personal</span></td><td>Selected (1)</td><td><span class="badge badge-success">Active</span></td></tr><tr><td>harbor-io <span class="caption subtle">organization</span></td><td>All repositories</td><td>${S.scenario === 'needs-reauth' ? '<span class="badge badge-warning">Suspended</span>' : '<span class="badge badge-success">Active</span>'}</td></tr></tbody></table></div>` : `<p class="small muted">Install the read-only GitHub App and choose repositories on GitHub.</p>`}</div>
        <div class="card-foot" style="flex-wrap:wrap">${connected ? `${S.scenario === 'needs-reauth' ? `<button class="btn btn-primary btn-sm" data-action="reconnect">Reconnect GitHub</button>` : `<button class="btn btn-sm" data-action="sync-now" ${S.scenario === 'rate-limited' || S.scenario === 'syncing' ? 'disabled' : ''}>${icon('refresh-cw')}Sync now</button>`}<a class="btn btn-sm btn-ghost" href="https://github.com/settings/installations" target="_blank" rel="noopener">${icon('external-link')}Manage on GitHub</a><span class="spacer"></span><button class="btn btn-sm btn-danger-outline" data-action="disconnect">Disconnect</button>` : `<a class="btn btn-primary btn-sm" href="#onboarding-connect">${icon('plug')}Connect GitHub</a>`}</div></section>
      ${connected ? `<section class="card" aria-labelledby="repo-h"><div class="card-head"><h2 id="repo-h">Repositories</h2><span class="meta">${S.repos.filter((r) => r.included).length} of ${S.repos.length} included</span></div><div class="card-body" style="padding:6px 0 0"><ul class="list">${repoRows}</ul></div><div class="card-foot"><span class="caption subtle">Changing a repository recalculates your KPIs for all periods in about a minute.</span></div></section>
      <section class="card" aria-labelledby="runs-h"><div class="card-head"><h2 id="runs-h">Sync history</h2></div><div class="table-wrap"><table class="table responsive"><thead><tr><th>Started</th><th>Trigger</th><th>Result</th><th class="num">New items</th><th class="num">Duration</th></tr></thead><tbody>${(S.scenario === 'sync-failed' ? [{ id: 'sx', trigger: 'scheduled', status: 'failed', queuedAt: TODAY - 0.25 * DAY, durationS: 12, counts: { prsAuthored: 0, prsReviewed: 0, reviews: 0, commits: 0 }, errors: [{ repo: 'harbor-io/ledger-service', code: 'UPSTREAM_ERROR', message: 'GitHub returned 502 while listing reviews. Retried 3 times.' }] }, ...DI.syncRuns] : DI.syncRuns).map((r) => `<tr><td>${DI.fmtDate(r.queuedAt, false)}, ${time(r.queuedAt)}</td><td>${cap(r.trigger)}</td><td>${r.status === 'succeeded' ? '<span class="badge badge-success">Succeeded</span>' : r.status === 'partial' ? '<span class="badge badge-warning">Partial</span>' : '<span class="badge badge-danger">Failed</span>'}${r.errors.length ? `<div class="caption subtle" style="margin-top:4px">${esc(r.errors[0].repo)}: ${esc(r.errors[0].message)}</div>` : ''}</td><td class="num">${fmtN(Object.values(r.counts).reduce((s, v) => s + v, 0))}</td><td class="num">${r.durationS}s</td></tr>`).join('')}</tbody></table></div></section>` : ''}
      <section aria-labelledby="planned-h" class="stack-3"><h2 id="planned-h" style="font-size:15px">Planned</h2><div class="grid g-3">${[['gitlab', 'GitLab', 'Merge requests and reviews'], ['kanban-square', 'Jira', 'Issues and story points'], ['list-todo', 'Linear', 'Issues and cycles']].map(([ic, t, d]) => `<div class="card card-pad stack-2" style="border-style:dashed"><div class="row"><span class="feed-ico">${icon(ic)}</span><b style="font-weight:500">${t}</b></div><span class="small muted">${d}</span><span class="caption subtle">Planned for v2.1</span></div>`).join('')}</div></section>
    </div>`);
  }
  function disconnectDialog() {
    return `<div class="dialog-head"><h2 id="dlg-title">Disconnect GitHub?</h2><p class="small muted" style="margin-top:6px">DevImpact stops syncing and revokes its GitHub token. Choose what happens to the data already imported.</p></div>
      <div class="dialog-body"><fieldset style="border:0;padding:0;margin:0" class="stack-2"><legend class="sr-only">Imported data</legend><label class="radio-card"><input type="radio" name="purge" value="keep" checked><span class="stack"><b style="font-weight:500">Keep my data</b><span class="small muted">KPIs, timeline and documents stay as they are. Reconnect any time to continue.</span></span></label><label class="radio-card"><input type="radio" name="purge" value="purge"><span class="stack"><b style="font-weight:500">Delete imported activity</b><span class="small muted">Removes 72 pull requests, 210 reviews and 224 commits. Documents and achievements are kept. This can't be undone.</span></span></label></fieldset></div>
      <div class="dialog-foot"><button class="btn" data-action="close">Cancel</button><button class="btn btn-danger" data-action="confirm-disconnect">Disconnect</button></div>`;
  }
  function vProfile() {
    const s = S.settings;
    const tzs = ['UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Kolkata', 'Asia/Singapore', 'Australia/Sydney'];
    return settingsWrap('Profile', 'Used to personalise documents and to compute every metric in your time zone.', `<div class="stack-4">
      <section class="card"><div class="card-body stack-4" style="padding-top:16px">
        <div class="row" style="gap:14px"><span class="avatar avatar-lg">${DI.USER.initials}</span><div class="stack"><b>${esc(s.name)}</b><span class="small muted">${esc(DI.USER.email)} · from GitHub</span></div></div>
        <div class="field"><label class="label" for="pf-name">Display name</label><input class="input" id="pf-name" value="${esc(s.name)}" maxlength="100"></div>
        <div class="field"><label class="label" for="pf-tz">Time zone</label><select class="select" id="pf-tz">${tzs.map((t) => `<option ${t === s.tz ? 'selected' : ''}>${t}</option>`).join('')}</select><span class="help">Changing it recalculates all KPIs and scores. Periods and business hours follow this time zone.</span></div>
        <div class="grid g-2"><div class="field"><label class="label" for="pf-role">Current role</label><input class="input" id="pf-role" value="${esc(s.role)}"></div><div class="field"><label class="label" for="pf-level">Level <span class="subtle" style="font-weight:400">(optional)</span></label><input class="input" id="pf-level" value="${esc(s.level)}"></div></div>
        <div class="field"><label class="label" for="pf-target">Target role <span class="subtle" style="font-weight:400">(optional)</span></label><input class="input" id="pf-target" value="${esc(s.target)}"><span class="help">Pre-fills promotion packets.</span></div>
        <div class="field"><span class="label" id="pf-dp">Default period</span><div class="seg" role="radiogroup" aria-labelledby="pf-dp">${['month', 'quarter', 'half', 'year'].map((v) => `<button role="radio" aria-checked="${s.defaultPeriod === v}" data-action="set-default-period" data-v="${v}">${cap(v)}</button>`).join('')}</div></div>
      </div><div class="card-foot"><span class="spacer"></span><button class="btn btn-primary" data-action="save-profile">Save changes</button></div></section>
      <section class="card"><div class="card-head"><h2>Sign-in methods</h2></div><div class="card-body" style="padding:6px 0 0"><ul class="list"><li class="list-item">${icon('github')}<span class="spacer">GitHub · @priyar</span><span class="badge">Primary</span></li><li class="list-item">${icon('mail')}<span class="spacer">Google</span><button class="btn btn-sm">Link Google</button></li></ul></div></section>
      <section class="card"><div class="card-head"><h2>Sessions</h2></div><div class="card-body" style="padding:6px 0 0"><ul class="list"><li class="list-item">${icon('monitor')}<span class="stack spacer"><span>Chrome on macOS</span><span class="caption subtle">London · this device</span></span></li><li class="list-item">${icon('smartphone')}<span class="stack spacer"><span>Safari on iPhone</span><span class="caption subtle">Last active 2 days ago</span></span><button class="btn btn-sm btn-ghost" data-action="revoke-session">Sign out</button></li></ul></div></section>
    </div>`);
  }
  function vNotifications() {
    const s = S.settings;
    const sw = (k, on, label) => `<button class="switch" role="switch" aria-checked="${on}" data-action="toggle-setting" data-k="${k}" aria-label="${esc(label)}"></button>`;
    return settingsWrap('Notifications', 'Emails go to ' + DI.USER.email + '. Every email has a one-click unsubscribe link.', `<div class="stack-4"><section class="card"><div class="card-body" style="padding-top:4px">
      <div class="setting-row"><div class="desc"><b style="font-weight:500">Weekly digest</b><p class="small muted">What you shipped and reviewed last week, plus suggested achievements.</p></div>${sw('digest', s.digest, 'Weekly digest')}</div>
      ${s.digest ? `<div class="setting-row"><div class="desc grid g-2" style="gap:12px"><div class="field"><label class="label" for="nf-day">Send on</label><select class="select" id="nf-day">${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d, i) => `<option ${i + 1 === s.digestDay ? 'selected' : ''}>${d}</option>`).join('')}</select></div><div class="field"><label class="label" for="nf-hour">At</label><select class="select" id="nf-hour">${[7, 8, 9, 10, 17].map((h) => `<option ${h === s.digestHour ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></div></div></div><div class="setting-row"><div class="desc"><span class="small muted">Times in ${esc(s.tz)}.</span></div><button class="btn btn-sm" data-action="digest-preview">${icon('eye')}Preview this week's digest</button></div>` : ''}
      <div class="setting-row"><div class="desc"><b style="font-weight:500">Sync problems</b><p class="small muted">When GitHub needs reconnecting or a sync keeps failing.</p></div>${sw('notifySync', s.notifySync, 'Sync problem emails')}</div>
      <div class="setting-row"><div class="desc"><b style="font-weight:500">Document ready</b><p class="small muted">When a long document finishes generating after you leave the page.</p></div>${sw('notifyDoc', s.notifyDoc, 'Document ready emails')}</div>
    </div></section></div>`);
  }
  function vPrivacy() {
    const s = S.settings;
    return settingsWrap('Privacy & data', 'Your data is private to you. No manager or teammate can see it.', `<div class="stack-4">
      <section class="card"><div class="card-body" style="padding-top:4px">
        <div class="setting-row"><div class="desc"><b style="font-weight:500">Repositories counted</b><p class="small muted">${S.repos.filter((r) => r.included).length} of ${S.repos.length} repositories are included.</p></div><a class="btn btn-sm" href="#account-integrations">Manage</a></div>
        <div class="setting-row"><div class="desc"><b style="font-weight:500">Redact private repository names in AI output</b><p class="small muted">Documents say "a private payments service" instead of the repository name.</p></div><button class="switch" role="switch" aria-checked="${s.redact}" data-action="toggle-setting" data-k="redact" aria-label="Redact private repository names"></button></div>
      </div></section>
      <section class="card"><div class="card-head"><h2>Export your data</h2></div><div class="card-body stack-2"><p class="small muted">A JSON file with your profile, settings, imported activity, metrics, documents with versions, achievements and goals. GitHub tokens are never included.</p><div class="row-wrap">${S.exportState === 'ready' ? `<span class="badge badge-success">${icon('circle-check')}Ready</span><span class="small">devimpact-export-2026-11-09.json · 1.8 MB</span>` : `<button class="btn btn-sm" data-action="export-data" ${S.exportState === 'working' ? 'disabled' : ''}>${S.exportState === 'working' ? icon('loader-circle', 'spin') + 'Preparing…' : icon('download') + 'Export data'}</button>`}<span class="caption subtle">Up to 3 exports a day</span></div></div></section>
      <section class="card" style="border-color:color-mix(in srgb, var(--destructive) 40%, var(--border))"><div class="card-head"><h2>Delete account</h2></div><div class="card-body stack-2"><p class="small muted">Permanently deletes your account, imported activity, documents, achievements and goals, and revokes DevImpact's GitHub access. This can't be undone.</p><button class="btn btn-sm btn-danger-outline" style="align-self:flex-start" data-action="delete-account">Delete account…</button></div></section>
    </div>`);
  }
  function deleteDialog() {
    return `<div class="dialog-head"><h2 id="dlg-title">Delete your account?</h2><p class="small muted" style="margin-top:6px">Everything is deleted immediately and can't be recovered. Export your data first if you might need it.</p></div>
      <div class="dialog-body"><div class="field"><label class="label" for="del-email">Type your email to confirm</label><input class="input" id="del-email" autocomplete="off" placeholder="${esc(DI.USER.email)}" data-input="del-email"><span class="help">${esc(DI.USER.email)}</span></div></div>
      <div class="dialog-foot"><button class="btn" data-action="close">Cancel</button><button class="btn btn-danger" id="del-confirm" data-action="confirm-delete" disabled>Delete account</button></div>`;
  }
  function vPlan() {
    const meter = (label, used, limit, note) => `<div><div class="meter-label"><span style="font-weight:500">${label}</span><span class="num">${used} of ${limit}</span></div><div class="progress" role="progressbar" aria-label="${label}" aria-valuenow="${used}" aria-valuemin="0" aria-valuemax="${limit}"><span style="width:${(used / limit) * 100}%"></span></div><span class="caption subtle">${note}</span></div>`;
    const gen = S.scenario === 'quota' ? 15 : S.usage.gen;
    return settingsWrap('Plan & usage', 'You are on the Free plan.', `<div class="stack-4">
      <section class="card"><div class="card-head"><h2>November usage</h2><span class="meta">Resets December 1 (UTC)</span></div><div class="card-body stack-4">${meter('AI document generations', gen, 15, 'Appraisals, promotion packets, resume bullets and regenerations. Reused results are free.')}${meter('Quick AI actions', S.usage.quick, 100, 'Achievement statements and impact highlights.')}</div></section>
      <section class="card"><div class="card-head"><h2>Plans</h2></div><div class="table-wrap"><table class="table"><thead><tr><th></th><th>Free <span class="badge badge-accent">Current</span></th><th>Pro</th></tr></thead><tbody>${[['History window', '12 months', '36 months'], ['AI generations / month', '15', '150'], ['Quick AI actions / month', '100', '1,000'], ['GitHub integrations', '1', '1'], ['Exports and weekly digest', 'Unlimited', 'Unlimited']].map(([k, a, b]) => `<tr><td class="muted">${k}</td><td>${a}</td><td>${b}</td></tr>`).join('')}</tbody></table></div><div class="card-foot"><span class="small">Need more? Email <span class="mono" style="user-select:all">upgrade@devimpact.dev</span> and we'll move you to Pro.</span></div></section>
    </div>`);
  }
  function vNotFound() { return `<div class="empty" style="padding-top:80px"><div class="e-ico">${icon('compass')}</div><h1 style="font-size:22px">Page not found</h1><p>The page may have moved, or the link is incomplete.</p><div class="e-actions"><a class="btn btn-primary" href="#dashboard">Go to dashboard</a><button class="btn" data-action="cmdk">Search</button></div></div>`; }
  function vServerError() { return `<div class="empty" style="padding-top:80px"><div class="e-ico">${icon('server-crash')}</div><h1 style="font-size:22px">Something went wrong on our side</h1><p>We've logged the problem. Try again in a moment — your data is safe.</p><div class="e-actions"><button class="btn btn-primary" data-action="retry">Try again</button><a class="btn" href="#dashboard">Go to dashboard</a></div><p class="caption subtle">Error ID 7f3c9a1e</p></div>`; }

  const VIEWS = { 'sign-in': vSignIn, 'onboarding-connect': vOnbConnect, 'onboarding-pending': vOnbPending, 'onboarding-repos': vOnbRepos, 'onboarding-sync': vOnbSync, dashboard: vDashboard, activity: vActivity, kpis: vKpis, impact: vImpact, career: vCareer, documents: vDocuments, 'new-document': vNewDocument, 'new-resume': () => studio('resume'), 'new-appraisal': () => studio('appraisal'), 'new-promotion': () => studio('promotion'), document: vDocument, achievements: vAchievements, goals: vGoals, 'account-integrations': vIntegrations, 'account-profile': vProfile, 'account-notifications': vNotifications, 'account-privacy': vPrivacy, 'account-plan': vPlan, 'not-found': vNotFound, 'server-error': vServerError };

  // ------------------------------------------------------------------ overlays
  function overlayHtml() {
    const o = S.overlay; let html = '';
    if (o) {
      if (o.kind === 'drawer') html += `<div class="overlay" data-action="close"></div><div class="drawer ${o.left ? 'drawer-left' : ''}" role="dialog" aria-modal="true" aria-labelledby="dlg-title">${o.html()}</div>`;
      else html += `<div class="overlay" data-action="close"></div><div class="dialog ${o.cls || ''}" role="${o.alert ? 'alertdialog' : 'dialog'}" aria-modal="true" aria-labelledby="dlg-title">${o.html()}</div>`;
    }
    return html;
  }
  function navDrawer() {
    return `<div class="drawer-head"><a class="brand" href="#dashboard" style="padding:0" id="dlg-title"><span class="brand-mark">${icon('activity')}</span>DevImpact</a><span class="spacer"></span><button class="btn btn-ghost btn-icon" data-action="close" aria-label="Close navigation">${icon('x')}</button></div><nav class="drawer-body" style="gap:0;padding:8px 10px" aria-label="Main">${NAV.map(([g, items]) => `<div class="nav-group"><div class="nav-group-label">${g}</div>${items.map(([k, l, ic]) => `<a class="nav-item" href="#${k}" data-action="close-go" data-to="${k}" ${ROUTES[route()].nav === k ? 'aria-current="page"' : ''}>${icon(ic)}${l}</a>`).join('')}</div>`).join('')}<div class="nav-group"><div class="nav-group-label">Account</div><a class="nav-item" href="#sign-in" data-action="close-go" data-to="sign-in">${icon('log-out')}Sign out</a></div></nav>`;
  }
  function periodPopover() {
    const presets = [['This month', 'month:2026-11'], ['Last month', 'month:2026-10'], ['This quarter', 'quarter:2026-Q4'], ['Last quarter', 'quarter:2026-Q3'], ['This half', 'half:2026-H2'], ['Last half', 'half:2026-H1'], ['This year', 'year:2026'], ['Last year', 'year:2025']];
    return `<div class="popover" id="period-pop" role="dialog" aria-label="Choose period" style="width:300px">${presets.map(([l, s]) => `<button class="menu-item" data-action="set-period" data-spec="${s}"><span>${l}</span><span class="hint">${esc(DI.period(s).label)}</span>${S.period === s ? `<span class="check-ico">${icon('check')}</span>` : ''}</button>`).join('')}<div class="menu-sep"></div><div class="menu-label">Custom range (7–366 days)</div><form class="stack-2" style="padding:4px 10px 8px" id="custom-form" novalidate><div class="grid g-2" style="gap:8px"><div class="field"><label class="caption subtle" for="cp-from">From</label><input class="input" type="date" id="cp-from" value="2026-09-15" max="${DI.iso(TODAY)}"></div><div class="field"><label class="caption subtle" for="cp-to">To</label><input class="input" type="date" id="cp-to" value="2026-11-08" max="${DI.iso(TODAY)}"></div></div><span class="error-text" id="cp-err" hidden></span><button class="btn btn-sm" type="submit">Apply range</button></form><div class="menu-sep"></div><div class="caption subtle" style="padding:4px 10px">Shareable URL: <span class="mono">?period=${esc(S.period)}</span></div></div>`;
  }
  function menuPopover(kind) {
    if (kind === 'new') return `<div class="popover" role="menu" aria-label="Create">${[['new-appraisal', 'file-text', 'Appraisal'], ['new-promotion', 'trending-up', 'Promotion packet'], ['new-resume', 'list-checks', 'Resume bullets']].map(([r, ic, l]) => `<a class="menu-item" role="menuitem" href="#${r}" data-action="close-go" data-to="${r}">${icon(ic)}${l}</a>`).join('')}<div class="menu-sep"></div><button class="menu-item" role="menuitem" data-action="add-achievement">${icon('award')}Achievement<span class="hint"><span class="kbd">A</span></span></button><button class="menu-item" role="menuitem" data-action="add-goal">${icon('target')}Goal</button></div>`;
    if (kind === 'user') return `<div class="popover" role="menu" aria-label="Account" style="bottom:56px;left:10px">${[['account-profile', 'user', 'Profile'], ['account-plan', 'gauge-circle', 'Plan & usage']].map(([r, ic, l]) => `<a class="menu-item" role="menuitem" href="#${r}" data-action="close-go" data-to="${r}">${icon(ic)}${l}</a>`).join('')}<button class="menu-item" role="menuitem" data-action="shortcuts">${icon('keyboard')}Keyboard shortcuts<span class="hint">?</span></button><div class="menu-sep"></div><a class="menu-item" role="menuitem" href="#sign-in" data-action="close-go" data-to="sign-in">${icon('log-out')}Sign out</a></div>`;
    if (kind === 'export') return `<div class="popover" role="menu" aria-label="Export">${[['copy-md', 'copy', 'Copy as Markdown'], ['copy-txt', 'clipboard', 'Copy as plain text']].map(([a, ic, l]) => `<button class="menu-item" role="menuitem" data-action="${a}">${icon(ic)}${l}</button>`).join('')}<div class="menu-sep"></div>${[['PDF', 'file-type'], ['DOCX', 'file-text'], ['Markdown', 'file-code']].map(([f, ic]) => `<button class="menu-item" role="menuitem" data-action="download" data-f="${f}">${icon(ic)}Download ${f}</button>`).join('')}</div>`;
    if (kind === 'regen') return `<div class="popover" role="menu" aria-label="Regenerate"><button class="menu-item" role="menuitem" data-action="regen-confirm">${icon('rotate-cw')}Regenerate document</button><a class="menu-item" role="menuitem" href="#new-${curDoc().type}" data-action="close-go" data-to="new-${curDoc().type}">${icon('sliders-horizontal')}Change options and regenerate</a><div class="menu-sep"></div><div class="menu-label">Section</div>${(curDoc().content || []).filter((s) => !s.engine).map((s) => `<button class="menu-item" role="menuitem" data-action="regen-section" data-k="${s.key}">${esc(s.title)}</button>`).join('')}</div>`;
    if (kind === 'docmore') return `<div class="popover" role="menu" aria-label="More"><button class="menu-item" role="menuitem" data-action="rename-doc">${icon('pencil')}Rename</button><button class="menu-item" role="menuitem" data-action="delete-doc" style="color:var(--destructive)">${icon('trash-2')}Delete document</button></div>`;
    if (kind === 'cite') { const e = DI.lookup(S.citeId) || S.achievements.find((a) => a.id === S.citeId); if (!e) return ''; return `<div class="popover" role="dialog" aria-label="Evidence" style="width:300px;padding:12px"><div class="stack-2"><span class="ref" style="align-self:flex-start">${esc(e.ref)}</span><b class="small" style="font-weight:600">${esc(e.title || e.message)}</b><span class="caption subtle">${e.mergedAt ? `Merged ${DI.fmtDate(e.mergedAt)} · +${e.additions} −${e.deletions}` : e.author ? `Reviewed · PR by @${esc(e.author)}` : e.authoredAt ? `Committed ${DI.fmtDate(e.authoredAt)}` : ''}</span><div class="row-wrap">${e.url ? `<a class="btn btn-sm" href="${e.url}" target="_blank" rel="noopener">${icon('external-link')}GitHub</a>` : ''}<button class="btn btn-sm btn-ghost" data-action="open-item" data-id="${e.mergedAt ? 'm-' + e.id : e.author ? (DI.reviews.find((r) => r.prId === e.id) || {}).id : e.id}">Details</button></div></div></div>`; }
    return '';
  }
  const ANCHORS = { period: 'period-btn', new: 'new-btn', user: 'user-btn', export: 'export-btn', regen: 'regen-btn', docmore: 'docmore-btn', proto: 'proto-btn' };
  function placePopover() {
    const pop = $('#pop-root .popover'); if (!pop) return;
    const a = S.popover === 'cite' ? S.citeEl : document.getElementById(ANCHORS[S.popover]); if (!a || !a.getBoundingClientRect) return;
    const r = a.getBoundingClientRect(); const w = pop.offsetWidth; const h = pop.offsetHeight;
    let left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8); if (S.popover === 'cite' || S.popover === 'user' || S.popover === 'proto') left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    let top = r.bottom + 6; if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    pop.style.position = 'fixed'; pop.style.left = left + 'px'; pop.style.top = top + 'px'; pop.style.bottom = 'auto';
  }
  function protoPanel() {
    return `<div class="popover" role="dialog" aria-label="Prototype controls" style="width:300px;max-height:72vh;overflow:auto">
      <div class="menu-label">Scenario</div>${SCENARIOS.map(([k, l]) => `<button class="menu-item" data-action="scenario" data-v="${k}">${l}${S.scenario === k ? `<span class="check-ico">${icon('check')}</span>` : ''}</button>`).join('')}
      <div class="menu-sep"></div><div class="menu-label">Flows</div>${[['sign-in', 'Sign in'], ['onboarding-connect', 'Onboarding'], ['new-appraisal', 'Generate an appraisal'], ['impact', 'Impact score detail'], ['server-error', '500 page'], ['nowhere', '404 page']].map(([r, l]) => `<a class="menu-item" href="#${r}" data-action="close-go" data-to="${r}">${l}</a>`).join('')}
      <button class="menu-item" data-action="deny-oauth">Onboarding: cancelled on GitHub</button>
      <button class="menu-item" data-action="fail-gen">Next generation fails</button>
      <div class="menu-sep"></div><button class="menu-item" data-action="reset">${icon('rotate-ccw')}Reset prototype</button>
      <p class="caption subtle" style="padding:6px 10px">Prototype controls are not part of the product. Data is synthetic and seeded.</p></div>`;
  }
  function cmdkHtml() {
    const items = cmdItems(S.cmdQ || '');
    S.cmdSel = Math.min(S.cmdSel || 0, Math.max(0, items.length - 1));
    let lastG = '';
    return `<div class="overlay" data-action="close-cmdk"></div><div class="dialog cmdk" role="dialog" aria-modal="true" aria-label="Command menu">
      <div class="cmdk-input">${icon('search')}<input id="cmdk-input" role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-activedescendant="cmd-${S.cmdSel}" aria-autocomplete="list" placeholder="Search pages and actions" value="${esc(S.cmdQ || '')}" autocomplete="off" data-input="cmdk"><span class="kbd">Esc</span></div>
      <div class="cmdk-list" role="listbox" id="cmdk-list">${items.length ? items.map((it, i) => { const g = it.g !== lastG ? `<div class="menu-label" role="presentation">${it.g}</div>` : ''; lastG = it.g; return g + `<div class="menu-item ${i === S.cmdSel ? 'active' : ''}" role="option" id="cmd-${i}" aria-selected="${i === S.cmdSel}" data-action="cmd-run" data-i="${i}">${icon(it.ic)}${esc(it.l)}${it.k ? `<span class="hint">${it.k}</span>` : ''}</div>`; }).join('') : `<div class="empty" style="padding:24px"><p>No results for “${esc(S.cmdQ)}”</p></div>`}</div>
      <div class="cmdk-foot"><span><span class="kbd">↑</span> <span class="kbd">↓</span> to move</span><span><span class="kbd">Enter</span> to select</span><span><span class="kbd">G</span> then <span class="kbd">D</span> dashboard</span></div></div>`;
  }
  function cmdItems(q) {
    const nav = NAV.flatMap(([g, items]) => items.map(([k, l, ic]) => ({ g: 'Go to', l, ic, run: () => go(k), k: { dashboard: 'G D', activity: 'G A', kpis: 'G K', career: 'G C', documents: 'G O' }[k] })));
    const acts = [
      { g: 'Actions', l: 'Sync GitHub now', ic: 'refresh-cw', run: () => act('sync-now') },
      { g: 'Actions', l: 'New appraisal', ic: 'file-text', run: () => go('new-appraisal') },
      { g: 'Actions', l: 'New promotion packet', ic: 'trending-up', run: () => go('new-promotion') },
      { g: 'Actions', l: 'New resume bullets', ic: 'list-checks', run: () => go('new-resume') },
      { g: 'Actions', l: 'Add achievement', ic: 'award', run: () => act('add-achievement'), k: 'A' },
      { g: 'Actions', l: 'Change period…', ic: 'calendar', run: () => { if (!ROUTES[route()].period) go('dashboard'); setTimeout(() => act('open-period'), 60); } },
      { g: 'Actions', l: 'Switch theme (system / light / dark)', ic: 'sun-moon', run: () => act('theme') },
      { g: 'Documents', l: 'Appraisal — H1 2026', ic: 'file', run: () => openDoc('d1') },
      { g: 'Documents', l: 'Promotion packet — Senior Software Engineer', ic: 'file', run: () => openDoc('d3') },
    ];
    const all = [...nav, ...acts]; if (!q) return all;
    return all.filter((i) => i.l.toLowerCase().includes(q.toLowerCase()));
  }

  // ------------------------------------------------------------------ render
  let lastFocusId = null;
  function render() {
    const r = route(); const rt = ROUTES[r];
    document.title = `${r === 'document' && curDoc() ? curDoc().title : rt.title} · DevImpact prototype`;
    const ae = document.activeElement; const fid = ae && ae.id ? ae.id : null;
    Object.keys(charts).forEach((k) => delete charts[k]);
    const view = VIEWS[r] || vNotFound;
    $('#app').innerHTML = rt.shell === false ? `<main id="main" tabindex="-1">${view()}</main>` : shell(r, view());
    renderOverlays();
    icons($('#app'));
    drawCharts();
    $$('.heat-wrap').forEach((h) => { h.scrollLeft = h.scrollWidth; });
    if (fid && document.getElementById(fid) && !S.overlay && !S.cmdk) document.getElementById(fid).focus({ preventScroll: true });
  }
  function renderOverlays() {
    $('#overlay-root').innerHTML = overlayHtml() + (S.cmdk ? cmdkHtml() : '');
    let pop = '';
    if (S.popover === 'period') pop = periodPopover(); else if (S.popover === 'proto') pop = protoPanel(); else if (S.popover) pop = menuPopover(S.popover);
    $('#pop-root').innerHTML = pop;
    icons($('#overlay-root')); icons($('#pop-root'));
    placePopover();
    drawCharts();
    $('#proto-btn').setAttribute('aria-expanded', S.popover === 'proto');
  }
  function icons(root) { if (window.lucide && root) { try { window.lucide.createIcons({ attrs: { 'stroke-width': 1.75 }, root }); } catch (e) { window.lucide.createIcons({ attrs: { 'stroke-width': 1.75 } }); } } }
  function openOverlay(o) { S.returnFocus = document.activeElement; S.overlay = o; S.popover = null; renderOverlays(); setTimeout(() => { const el = $('#overlay-root [role="dialog"], #overlay-root [role="alertdialog"]'); if (!el) return; const f = el.querySelector('input:not([type=hidden]):not([disabled]), textarea, select, button:not([disabled]), a[href]'); (o.focusFirstInput && f ? f : el.querySelector('[data-action="close"]') || f || el).focus(); }, 20); }
  function closeOverlay() { S.overlay = null; S.cmdk = false; S.popover = null; renderOverlays(); if (S.returnFocus && document.body.contains(S.returnFocus)) S.returnFocus.focus(); }
  function openDoc(id) { S.currentDoc = id; S.docEdit = false; go('document'); }

  // ------------------------------------------------------------------ generation simulation
  function startGeneration(type, spec) {
    const fail = S.failNext; S.failNext = false;
    const p = DI.period(spec);
    const doc = { id: 'n' + Date.now(), type, title: type === 'appraisal' ? `Appraisal — ${p.label}` : type === 'promotion' ? `Promotion packet — ${S.settings.target}` : `Resume bullets — ${(S.studio && S.studio.role) || 'Backend'}`, period: spec, status: 'streaming', version: 1, source: 'generated', coverage: null, flags: { uncited: 0, invalid: 0 }, createdAt: TODAY, updatedAt: TODAY };
    doc.content = buildContent(doc);
    S.docs.unshift(doc); S.currentDoc = doc.id; S.docEdit = false;
    S.gen = { docId: doc.id, status: 'streaming', index: 0, chars: 0 };
    go('document');
    const tick = () => {
      const g = S.gen; if (!g || g.status !== 'streaming' || g.docId !== doc.id) return;
      const sec = doc.content[g.index]; const len = sec.html.replace(/<[^>]+>/g, '').length;
      if (fail && g.index === 2) { g.status = 'failed'; doc.status = 'failed'; refreshDoc(); toast('The draft could not be finished. Nothing was counted against your quota.', 'err'); return; }
      g.chars += reduceMotion() ? len : sec.engine ? len : 9;
      if (g.chars >= len) { g.index++; g.chars = 0; }
      if (g.index >= doc.content.length) {
        g.status = 'done'; doc.status = 'ready'; const flags = doc.content.some((s) => s.html.includes('data-flag')) ? 1 : 0; doc.flags = { uncited: flags, invalid: 0 }; doc.coverage = flags ? 0.92 : 1; S.usage.gen++;
        refreshDoc(); toast(`${typeLabel[type]} ready — ${Math.round(doc.coverage * 100)}% of claims cited.`, 'ok', route() === 'document' && S.currentDoc === doc.id ? null : ['Open', 'open-doc-' + doc.id]); return;
      }
      refreshDoc(); setTimeout(tick, reduceMotion() ? 450 : sec.engine ? 500 : 28);
    };
    setTimeout(tick, 700);
  }
  function refreshDoc() { const r = route(); if (r === 'document' || r === 'documents') render(); else { const n = $('.sidebar'); if (n) render(); } }

  // ------------------------------------------------------------------ actions
  function act(name, el) {
    const d = el ? el.dataset : {};
    switch (name) {
      case 'close': case 'close-cmdk': closeOverlay(); break;
      case 'close-go': S.overlay = null; S.popover = null; S.cmdk = false; renderOverlays(); break; // link navigates
      case 'go': go(d.to); break;
      case 'skip': setTimeout(() => $('#main') && $('#main').focus(), 0); break;
      case 'theme': { const order = ['system', 'light', 'dark']; S.theme = order[(order.indexOf(S.theme) + 1) % 3]; store.set('theme', S.theme); applyTheme(); render(); toast(`Theme: ${cap(S.theme)}`, 'info'); break; }
      case 'cmdk': S.returnFocus = document.activeElement; S.cmdk = true; S.cmdQ = ''; S.cmdSel = 0; S.popover = null; renderOverlays(); setTimeout(() => $('#cmdk-input') && $('#cmdk-input').focus(), 10); break;
      case 'cmd-run': { const it = cmdItems(S.cmdQ || '')[+d.i]; S.cmdk = false; renderOverlays(); if (it) it.run(); break; }
      case 'cmdk-achievement': case 'add-achievement': S.popover = null; openOverlay({ kind: 'dialog', html: () => achDialog(), focusFirstInput: true }); break;
      case 'open-nav': openOverlay({ kind: 'drawer', left: true, html: navDrawer }); break;
      case 'open-period': case 'open-new': case 'open-user': case 'open-export': case 'open-regen': case 'open-docmore': { const k = name.slice(5); S.popover = S.popover === k ? null : k; renderOverlays(); const first = $('#pop-root .menu-item, #pop-root button, #pop-root a'); if (first && S.popover) first.focus(); break; }
      case 'proto': S.popover = S.popover === 'proto' ? null : 'proto'; renderOverlays(); break;
      case 'set-period': S.period = d.spec; S.popover = null; S.act.shown = 40; render(); toast(`Showing ${DI.period(d.spec).label}`, 'info'); break;
      case 'scenario': S.scenario = d.v; store.set('scenario', d.v); S.popover = null; render(); toast(`Scenario: ${SCENARIOS.find((s) => s[0] === d.v)[1]}`, 'info'); break;
      case 'reset': try { localStorage.clear(); } catch (e) { /* ignore */ } location.hash = 'dashboard'; location.reload(); break;
      case 'deny-oauth': S.onboarding.denied = true; S.popover = null; go('onboarding-connect'); break;
      case 'fail-gen': S.failNext = true; S.popover = null; renderOverlays(); toast('The next generation will fail at section 3.', 'info'); break;
      case 'retry': render(); toast('Retried. Still unreachable in this scenario — switch scenario in the Prototype menu.', 'info'); break;
      case 'explain': openOverlay({ kind: 'drawer', html: () => explainDrawer(d.key) }); break;
      case 'explain-impact': go('impact'); break;
      case 'toggle-table': S.showTables[d.id] = !S.showTables[d.id]; S.overlay ? renderOverlays() : render(); break;
      case 'jump': { const t = document.getElementById(d.to); if (t) { t.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' }); t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: true }); } break; }
      case 'open-item': S.popover = null; openOverlay({ kind: 'drawer', html: () => itemDrawer(d.id) }); break;
      case 'cite': S.citeId = d.id; S.citeEl = el; S.popover = 'cite'; renderOverlays(); break;
      case 'act-type': S.act.type = d.v; S.act.shown = 40; render(); break;
      case 'act-more': S.act.shown += 40; render(); break;
      case 'act-clear': S.act = { type: 'all', repo: 'all', q: '', shown: 40 }; render(); break;
      case 'doc-type': S.docsFilter.type = d.v; render(); break;
      case 'doc-clear': S.docsFilter = { type: 'all', q: '' }; render(); break;
      case 'ach-cat': S.ach.cat = d.v; render(); break;
      case 'career-year': S.career.year = +d.v; render(); break;
      case 'career-more': S.career.expanded[d.key] = true; render(); break;
      case 'print-view': toast('In the app this opens a print-friendly timeline. Printing is disabled in this prototype.', 'info'); break;
      case 'open-doc': openDoc(d.id); break;
      case 'signin': case 'signin-demo': S.scenario = 'first-run'; store.set('scenario', 'first-run'); go('onboarding-connect'); break;
      case 'install-app': { const b = $('#install-btn'); if (b) { b.disabled = true; b.innerHTML = 'Opening GitHub…'; } setTimeout(() => go('onboarding-repos'), 900); break; }
      case 'check-approval': toast('Still waiting for harbor-io. We\'ll email you when it\'s approved.', 'info'); break;
      case 'toggle-repo-sel': S.onboarding.repoSel[d.id] = !S.onboarding.repoSel[d.id]; render(); break;
      case 'repos-recent': S.onboarding.repoSel = Object.fromEntries(S.repos.map((r) => [r.id, r.lastActivity > TODAY - 365 * DAY])); render(); break;
      case 'start-sync': S.onboarding.sync = { stage: 0, pct: 0 }; go('onboarding-sync'); runSync(); break;
      case 'finish-onboarding': S.scenario = S.onboarding.sync && S.onboarding.sync.pct >= 100 ? 'populated' : 'syncing'; store.set('scenario', S.scenario); go('dashboard'); setTimeout(() => { if (S.scenario === 'syncing') { S.scenario = 'populated'; store.set('scenario', 'populated'); if (route() === 'dashboard') render(); toast('Import complete — your full 12 months are in.'); } }, 12000); break;
      case 'sync-now': if (S.scenario === 'needs-reauth') { act('reconnect'); break; } toast('Sync started. New activity appears in a minute or two.', 'info'); setTimeout(() => { if (S.scenario === 'sync-failed') { S.scenario = 'populated'; store.set('scenario', 'populated'); render(); } toast('Sync finished — 3 new items.'); }, 2500); break;
      case 'reconnect': toast('Opening GitHub to re-authorise…', 'info'); setTimeout(() => { S.scenario = 'populated'; store.set('scenario', 'populated'); render(); toast('GitHub reconnected. Syncing new activity now.'); }, 1400); break;
      case 'disconnect': openOverlay({ kind: 'dialog', alert: true, html: disconnectDialog }); break;
      case 'confirm-disconnect': { const purge = $('input[name="purge"]:checked').value === 'purge'; closeOverlay(); S.scenario = 'first-run'; store.set('scenario', 'first-run'); render(); toast(purge ? 'GitHub disconnected and imported activity deleted.' : 'GitHub disconnected. Your data is kept.'); break; }
      case 'toggle-repo': { const r = S.repos.find((x) => x.id === d.id); r.included = !r.included; if (DI.REPO_BY_NAME[r.name]) DI.REPO_BY_NAME[r.name].included = r.included; render(); toast(`${r.name} ${r.included ? 'included' : 'excluded'}. KPIs are being recalculated.`, 'info'); break; }
      case 'toggle-setting': S.settings[d.k] = !S.settings[d.k]; render(); toast('Saved'); break;
      case 'set-default-period': S.settings.defaultPeriod = d.v; render(); break;
      case 'save-profile': S.settings.name = $('#pf-name').value || S.settings.name; S.settings.tz = $('#pf-tz').value; render(); toast('Profile saved'); break;
      case 'revoke-session': toast('Signed out of Safari on iPhone'); break;
      case 'digest-preview': openOverlay({ kind: 'dialog', html: digestPreview }); break;
      case 'export-data': S.exportState = 'working'; render(); setTimeout(() => { S.exportState = 'ready'; if (route() === 'account-privacy') render(); toast('Export ready. In the app it downloads automatically; downloads are disabled in this prototype.'); }, 1600); break;
      case 'delete-account': openOverlay({ kind: 'dialog', alert: true, html: deleteDialog, focusFirstInput: true }); break;
      case 'confirm-delete': closeOverlay(); go('sign-in'); toast('Account deleted. We\'re sorry to see you go.'); break;
      case 'save-ach': {
        const t = $('#af-title'); if (!t.value.trim()) { t.setAttribute('aria-invalid', 'true'); $('#af-title-err').hidden = false; t.focus(); break; }
        const a = { id: 'a' + Date.now(), title: t.value.trim(), category: $('#af-cat').value, occurredOn: $('#af-date').value || DI.iso(TODAY), description: '', impact: $('#af-impact').value, evidence: (d.evidence || '').split(',').filter(Boolean), links: [], source: d.evidence ? 'from_activity' : 'manual' }; a.ref = 'ACH-' + a.id;
        S.achievements.unshift(a); closeOverlay(); if (route() === 'achievements') render(); toast('Achievement saved', 'ok', ['View', 'go-achievements']); break;
      }
      case 'go-achievements': go('achievements'); break;
      case 'del-ach': { const i = S.achievements.findIndex((a) => a.id === d.id); const [a] = S.achievements.splice(i, 1); S.undo = { a, i }; render(); toast(`Deleted “${esc(a.title)}”`, 'ok', ['Undo', 'undo-ach']); break; }
      case 'undo-ach': if (S.undo) { S.achievements.splice(S.undo.i, 0, S.undo.a); S.undo = null; render(); toast('Restored'); } break;
      case 'ach-from-pr': { const pr = DI.prs.find((x) => x.id === d.id); el.disabled = true; el.innerHTML = `${icon('loader-circle', 'spin')}Drafting…`; icons(el); setTimeout(() => { S.usage.quick++; openOverlay({ kind: 'dialog', html: () => achDialog({ fromPr: pr.ref, title: pr.title, category: 'delivery', date: DI.iso(pr.mergedAt || pr.createdAt), statement: `${pr.title} in ${pr.repo.split('/')[1]}, merged after ${pr.approvals} approval${pr.approvals > 1 ? 's' : ''} as a ${pr.lines <= 400 ? 'small, easy-to-review' : 'staged'} change.`, evidence: [pr.id] }), focusFirstInput: true }); }, 1100); break; }
      case 'add-goal': S.popover = null; openOverlay({ kind: 'dialog', html: goalDialog, focusFirstInput: true }); break;
      case 'save-goal': { const t = $('#gf-title').value.trim() || 'New goal'; const mk = $('#gf-metric').value; const v = parseFloat($('#gf-val').value); S.goals.push({ id: 'g' + Date.now(), title: t, metricTarget: mk && !isNaN(v) ? { metricKey: mk, comparator: $('#gf-cmp').value === 'At most' ? 'lte' : 'gte', targetValue: DI.DEF[mk].unit === 'ratio' && v > 1 ? v / 100 : v } : null, startDate: DI.iso(TODAY), targetDate: $('#gf-date').value || '2026-12-31', status: 'active', achievementIds: [] }); closeOverlay(); go('goals'); render(); toast('Goal added'); break; }
      case 'studio-role': S.studio.role = d.v; render(); break;
      case 'cancel-gen': if (S.gen) { S.gen.status = 'cancelled'; const doc = curDoc(); doc.status = 'cancelled'; render(); toast('Generation stopped. Nothing was counted against your quota.', 'info'); } break;
      case 'regen': case 'regen-confirm': {
        S.popover = null;
        if (name === 'regen-confirm') { openOverlay({ kind: 'dialog', html: () => `<div class="dialog-head"><h2 id="dlg-title">Regenerate this document?</h2><p class="small muted" style="margin-top:6px">A new version is written from the same options and current evidence. Version ${curDoc().version} stays in history, including your edits.</p></div><div class="dialog-foot"><span class="caption subtle spacer">Uses 1 generation</span><button class="btn" data-action="close">Cancel</button><button class="btn btn-primary" data-action="regen">Regenerate</button></div>` }); break; }
        closeOverlay(); const doc = curDoc(); startGeneration(doc.type, doc.period); break;
      }
      case 'regen-section': S.popover = null; renderOverlays(); toast(`Rewriting “${esc((curDoc().content.find((s) => s.key === d.k) || {}).title)}”… saved as v${curDoc().version + 1}.`, 'info'); curDoc().version++; render(); break;
      case 'doc-edit': S.docEdit = !S.docEdit; render(); if (!S.docEdit) toast(`Saved as v${curDoc().version}`); break;
      case 'restore': { const doc = curDoc(); doc.version++; doc.source = 'restore'; render(); toast(`Restored v${d.v} as v${doc.version}`); break; }
      case 'copy-md': case 'copy-txt': { S.popover = null; renderOverlays(); const txt = $('.doc') ? $('.doc').innerText : ''; const ok = () => toast(name === 'copy-md' ? 'Copied as Markdown' : 'Copied as plain text'); try { navigator.clipboard.writeText(txt).then(ok, () => toast('Copy was blocked by the browser. Select the text and copy it manually.', 'err')); } catch (e) { toast('Copy was blocked by the browser. Select the text and copy it manually.', 'err'); } break; }
      case 'download': { S.popover = null; renderOverlays(); const doc = curDoc(); const ext = { PDF: 'pdf', DOCX: 'docx', Markdown: 'md' }[d.f]; toast(`In the app this downloads <span class="mono">${doc.type}-${doc.period.split(':')[1]}-v${doc.version}.${ext}</span>. Downloads are disabled in this prototype.`, 'info'); break; }
      case 'rename-doc': S.popover = null; renderOverlays(); toast('Click the title to rename (inline edit in the app).', 'info'); break;
      case 'delete-doc': S.popover = null; openOverlay({ kind: 'dialog', alert: true, html: () => `<div class="dialog-head"><h2 id="dlg-title">Delete “${esc(curDoc().title)}”?</h2><p class="small muted" style="margin-top:6px">All ${curDoc().version} versions are deleted. This can't be undone.</p></div><div class="dialog-foot"><button class="btn" data-action="close">Cancel</button><button class="btn btn-danger" data-action="confirm-delete-doc">Delete document</button></div>` }); break;
      case 'confirm-delete-doc': { const t = curDoc().title; S.docs = S.docs.filter((x) => x.id !== S.currentDoc); closeOverlay(); go('documents'); toast(`Deleted “${esc(t)}”`); break; }
      case 'gen-highlights': { const p = P(); S.highlights = { spec: p.spec, loading: true }; render(); setTimeout(() => { S.highlights = { spec: p.spec }; S.usage.quick++; if (route() === 'impact') render(); }, 1500); break; }
      case 'toggle-keys': S.singleKeys = !S.singleKeys; store.set('keys', S.singleKeys); renderOverlays(); toast(S.singleKeys ? 'Single-key shortcuts on' : 'Single-key shortcuts off'); break;
      case 'dismiss-nba': toast('Hidden for 7 days', 'info'); break;
      case 'shortcuts': S.popover = null; openOverlay({ kind: 'dialog', html: shortcutsDialog }); break;
      case 'copy': { const t = document.getElementById(d.target).innerText; try { navigator.clipboard.writeText(t).then(() => toast('Message copied'), () => toast('Copy was blocked. Select the text and copy it manually.', 'err')); } catch (e) { toast('Copy was blocked. Select the text and copy it manually.', 'err'); } break; }
      case 'noop-evidence': toast('In the app this opens a searchable list of your PRs and reviews.', 'info'); break;
      default:
        if (name && name.startsWith('open-doc-')) { openDoc(name.slice(9)); }
    }
  }
  function digestPreview() {
    const p = DI.period('custom:2026-11-02..2026-11-08'); const m = DI.metrics(p);
    return `<div class="dialog-head"><span class="caption subtle">Preview · not sent</span><h2 id="dlg-title">Your week: Nov 2 – Nov 8</h2></div><div class="dialog-body"><p>You merged <b>${m.prs_merged.value}</b> pull requests and reviewed <b>${m.prs_reviewed.value}</b> across ${m.repos_contributed.value} repositories.</p><div class="well stack-2"><b class="small" style="font-weight:600">Worth capturing</b>${m.prs_merged.evidence.slice(0, 2).map((id) => `<span class="small">${esc(DI.lookup(id).title)} <span class="ref">${esc(DI.lookup(id).ref)}</span></span>`).join('') || '<span class="small muted">No merged PRs this week.</span>'}</div><p class="caption subtle">Unsubscribe from the weekly digest with one click — no sign-in needed.</p></div><div class="dialog-foot"><button class="btn" data-action="close">Close</button></div>`;
  }
  function shortcutsDialog() {
    return `<div class="dialog-head"><h2 id="dlg-title">Keyboard shortcuts</h2></div><div class="dialog-body"><table class="table"><tbody>${[['⌘K / Ctrl K', 'Search and commands'], ['G then D', 'Dashboard'], ['G then A', 'Activity'], ['G then K', 'KPIs'], ['G then C', 'Career'], ['G then O', 'Documents'], ['A', 'Add achievement'], ['?', 'This list'], ['Esc', 'Close dialogs and menus']].map(([k, v]) => `<tr><td><span class="kbd">${k}</span></td><td>${v}</td></tr>`).join('')}</tbody></table><div class="setting-row" style="border-top:1px solid var(--border)"><div class="desc"><b style="font-weight:500">Single-key shortcuts</b><p class="small muted">G, A and ? shortcuts. Turn off if you use speech input or they get in the way.</p></div><button class="switch" role="switch" aria-checked="${S.singleKeys}" data-action="toggle-keys" aria-label="Single-key shortcuts"></button></div></div><div class="dialog-foot"><button class="btn" data-action="close">Close</button></div>`;
  }
  function runSync() {
    const step = () => {
      const s = S.onboarding.sync; if (!s) return;
      s.pct = Math.min(100, s.pct + (reduceMotion() ? 10 : 1.6)); s.stage = s.pct < 8 ? 0 : s.pct < 45 ? 1 : s.pct < 70 ? 2 : s.pct < 92 ? 3 : 4;
      if (route() === 'onboarding-sync') render();
      if (s.pct < 100) setTimeout(step, reduceMotion() ? 600 : 140);
    };
    setTimeout(step, 300);
  }

  // ------------------------------------------------------------------ events
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (S.popover && !e.target.closest('#pop-root') && !(el && /^open-|^proto$|^cite$/.test(el.dataset.action))) { S.popover = null; renderOverlays(); }
    if (!el) return;
    const a = el.dataset.action;
    if (el.tagName === 'A' && !['close-go', 'open-doc', 'skip'].includes(a)) e.preventDefault();
    if (a === 'open-doc' && el.tagName === 'A') e.preventDefault();
    if (el.tagName === 'TR' && e.target.closest('a')) return;
    act(a, el);
  });
  document.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.id === 'custom-form') {
      const f = $('#cp-from').value, t = $('#cp-to').value; const err = $('#cp-err');
      const days = (Date.parse(t) - Date.parse(f)) / DAY + 1;
      const msg = !f || !t ? 'Choose both dates' : days < 7 ? 'Choose at least 7 days' : days > 366 ? 'Choose 366 days or fewer' : Date.parse(f) > TODAY ? 'Start date is in the future' : '';
      if (msg) { err.hidden = false; err.textContent = msg; return; }
      act('set-period', { dataset: { spec: `custom:${f}..${t}` } });
    }
    if (e.target.id === 'studio-form') {
      const type = e.target.dataset.type;
      if (type === 'promotion' && !$('#st-tgt').value.trim()) { $('#st-tgt').setAttribute('aria-invalid', 'true'); $('#st-tgt-err').hidden = false; $('#st-tgt').focus(); return; }
      const spec = (S.studio && S.studio[type + 'Period']) || (type === 'appraisal' ? 'half:2026-H2' : 'custom:2025-11-09..2026-11-08');
      startGeneration(type, spec);
    }
  });
  document.addEventListener('change', (e) => {
    const k = e.target.dataset.change; if (!k) return;
    if (k === 'act-repo') { S.act.repo = e.target.value === 'All repositories' ? 'all' : e.target.value; S.act.shown = 40; render(); }
    if (k === 'studio-period') { S.studio[e.target.dataset.type + 'Period'] = e.target.value; render(); }
  });
  let inputTimer;
  document.addEventListener('input', (e) => {
    const k = e.target.dataset.input; if (!k) return;
    if (k === 'act-q') { S.act.q = e.target.value; clearTimeout(inputTimer); inputTimer = setTimeout(render, 250); }
    if (k === 'doc-q') { S.docsFilter.q = e.target.value; clearTimeout(inputTimer); inputTimer = setTimeout(render, 250); }
    if (k === 'cmdk') { S.cmdQ = e.target.value; S.cmdSel = 0; const pos = e.target.selectionStart; renderOverlays(); const i = $('#cmdk-input'); i.focus(); i.setSelectionRange(pos, pos); }
    if (k === 'del-email') { $('#del-confirm').disabled = e.target.value.trim().toLowerCase() !== DI.USER.email; }
    if (k === 'doc-edit') { S.docSave = 'saving'; const st = $('.doc-head [role="status"]'); if (st) st.textContent = 'Saving…'; clearTimeout(inputTimer); inputTimer = setTimeout(() => { const doc = curDoc(); if (doc.source !== 'user_edit') { doc.version++; doc.source = 'user_edit'; } S.docSave = 'saved'; const s2 = $('.doc-head [role="status"]'); if (s2) s2.textContent = `Saved · v${doc.version}`; }, 900); }
  });
  let gPending = false;
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); S.cmdk ? closeOverlay() : act('cmdk'); return; }
    if (e.key === 'Escape') { if (S.cmdk || S.overlay) { e.preventDefault(); closeOverlay(); return; } if (S.popover) { const k = S.popover; S.popover = null; renderOverlays(); const a = document.getElementById(ANCHORS[k]); if (a) a.focus(); return; } }
    if (S.cmdk && e.target.id === 'cmdk-input') {
      const n = cmdItems(S.cmdQ || '').length;
      if (e.key === 'ArrowDown') { e.preventDefault(); S.cmdSel = (S.cmdSel + 1) % Math.max(1, n); renderOverlays(); $('#cmdk-input').focus(); $('#cmd-' + S.cmdSel) && $('#cmd-' + S.cmdSel).scrollIntoView({ block: 'nearest' }); }
      if (e.key === 'ArrowUp') { e.preventDefault(); S.cmdSel = (S.cmdSel - 1 + n) % Math.max(1, n); renderOverlays(); $('#cmdk-input').focus(); $('#cmd-' + S.cmdSel) && $('#cmd-' + S.cmdSel).scrollIntoView({ block: 'nearest' }); }
      if (e.key === 'Enter') { e.preventDefault(); act('cmd-run', { dataset: { i: S.cmdSel } }); }
      return;
    }
    if (e.key === 'Tab' && (S.overlay || S.cmdk)) { const box = $('#overlay-root [role="dialog"], #overlay-root [role="alertdialog"]'); if (box) { const f = $$('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])', box).filter((x) => x.offsetParent !== null); if (f.length) { const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } } } }
    if (S.popover && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { const items = $$('#pop-root .menu-item'); if (items.length) { e.preventDefault(); const i = items.indexOf(document.activeElement); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus(); } return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey || S.overlay) return;
    if (gPending) { gPending = false; const map = { d: 'dashboard', a: 'activity', k: 'kpis', c: 'career', o: 'documents' }; if (map[e.key]) { go(map[e.key]); return; } }
    if (!S.singleKeys) return;
    if (e.key === 'g') { gPending = true; setTimeout(() => (gPending = false), 1200); return; }
    if (e.key === 'a' && ROUTES[route()].shell !== false) { act('add-achievement'); return; }
    if (e.key === '?') act('shortcuts');
  });
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-tip]'); const tip = $('#tooltip');
    if (!t) { tip.classList.remove('on'); $$('.hover-band.on').forEach((b) => b.classList.remove('on')); return; }
    tip.innerHTML = t.getAttribute('data-tip'); tip.classList.add('on');
    const band = t.previousElementSibling && t.parentNode ? $$('.hover-band', t.parentNode) : []; $$('.hover-band.on').forEach((b) => b.classList.remove('on'));
    const idx = [...t.parentNode.querySelectorAll('.hit')].indexOf(t); if (band[idx]) band[idx].classList.add('on');
  });
  document.addEventListener('mousemove', (e) => { const tip = $('#tooltip'); if (!tip.classList.contains('on')) return; const w = tip.offsetWidth, h = tip.offsetHeight; let x = e.clientX + 14, y = e.clientY + 14; if (x + w > window.innerWidth - 8) x = e.clientX - w - 14; if (y + h > window.innerHeight - 8) y = e.clientY - h - 14; tip.style.left = x + 'px'; tip.style.top = y + 'px'; });
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { drawCharts(); placePopover(); }, 120); });
  window.addEventListener('hashchange', () => { S.popover = null; S.overlay = null; S.cmdk = false; render(); window.scrollTo(0, 0); const m = $('#main'); if (m) m.focus({ preventScroll: true }); });
  function applyTheme() { if (S.theme === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', S.theme); }

  applyTheme();
  render();
  if (!window.lucide) { const s = document.querySelector('script[data-lucide-src]'); if (s) s.addEventListener('load', () => render()); }
})();
