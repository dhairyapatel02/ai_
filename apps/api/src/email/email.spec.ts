import { lastCompleteWeekStart, weekLabel } from './digest-builder.service';
import { digestDue, localHour } from './digest-scheduler.service';
import { clean, esc, renderDigest, type DigestContent } from './digest-template';
import { createUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe-token';

const SECRET = 'unit-test-unsubscribe-secret-0123456789abcdef';
const USER = 'cmabcdefghijklmnopqrstuvw';

describe('unsubscribe tokens', () => {
  const now = new Date('2026-11-24T10:00:00Z');

  it('round-trips user and list until expiry', () => {
    const token = createUnsubscribeToken(SECRET, { userId: USER, list: 'digest' }, 60, now);
    expect(verifyUnsubscribeToken(SECRET, token, now)).toEqual({
      ok: true,
      claims: { userId: USER, list: 'digest', exp: Math.floor(now.getTime() / 1000) + 60 * 86_400 },
    });
    const later = new Date(now.getTime() + 61 * 86_400_000);
    expect(verifyUnsubscribeToken(SECRET, token, later)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects forged, tampered and malformed tokens', () => {
    const token = createUnsubscribeToken(SECRET, { userId: USER, list: 'digest' }, 60, now);
    const [payload, sig] = token.split('.') as [string, string];
    const forged = createUnsubscribeToken(
      'another-secret-of-sufficient-length-000',
      { userId: USER, list: 'all' },
      60,
      now,
    );
    const swapped = Buffer.from(JSON.stringify({ u: USER, l: 'all', e: 4102444800 })).toString(
      'base64url',
    );
    for (const bad of [
      forged,
      `${swapped}.${sig}`,
      `${payload}.${sig.slice(0, -2)}`,
      `${payload}.`,
      payload,
      `${payload}.${sig}.x`,
      '',
    ]) {
      expect(verifyUnsubscribeToken(SECRET, bad, now)).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('rejects well-signed payloads with unexpected claims', () => {
    const sign = (claims: unknown) => {
      // Re-use the signer through a valid token for a crafted payload.
      const { createHmac } = jest.requireActual<typeof import('node:crypto')>('node:crypto');
      const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
      return `${p}.${createHmac('sha256', SECRET).update(`unsub.v1.${p}`).digest('base64url')}`;
    };
    expect(
      verifyUnsubscribeToken(SECRET, sign({ u: USER, l: 'marketing', e: 4102444800 }), now).ok,
    ).toBe(false);
    expect(
      verifyUnsubscribeToken(SECRET, sign({ u: "'; drop table", l: 'digest', e: 4102444800 }), now)
        .ok,
    ).toBe(false);
    expect(
      verifyUnsubscribeToken(SECRET, sign({ u: USER, l: 'digest', e: '4102444800' }), now).ok,
    ).toBe(false);
    expect(
      verifyUnsubscribeToken(SECRET, sign({ u: USER, l: 'all', e: 4102444800 }), now),
    ).toMatchObject({ ok: true });
  });
});

describe('digest schedule (fake clock, time zones, DST)', () => {
  const monday9 = { digestDayOfWeek: 1, digestHourLocal: 9 };

  it('Pacific/Auckland vs America/Los_Angeles week boundaries at the same instant', () => {
    // 2026-11-22T20:00Z = Mon 23 Nov 09:00 in Auckland (UTC+13) = Sun 22 Nov 12:00 in Los Angeles.
    const now = new Date('2026-11-22T20:00:00Z');
    expect(digestDue(now, { ...monday9, timezone: 'Pacific/Auckland' })).toEqual({
      due: true,
      weekStart: '2026-11-16',
    });
    expect(digestDue(now, { ...monday9, timezone: 'America/Los_Angeles' })).toEqual({
      due: false,
      weekStart: '2026-11-09',
    });
    // LA's Monday 09:00 is 17:00Z the next day; by then Auckland's week has moved on.
    const la = new Date('2026-11-23T17:00:00Z');
    expect(digestDue(la, { ...monday9, timezone: 'America/Los_Angeles' })).toEqual({
      due: true,
      weekStart: '2026-11-16',
    });
    expect(digestDue(la, { ...monday9, timezone: 'Pacific/Auckland' }).due).toBe(false); // Tuesday there
  });

  it('is not due before the local hour, due from it on (same week), not due on other days', () => {
    const tz = { ...monday9, timezone: 'Europe/London' };
    expect(digestDue(new Date('2026-11-23T08:59:00Z'), tz).due).toBe(false);
    expect(digestDue(new Date('2026-11-23T09:00:00Z'), tz)).toEqual({
      due: true,
      weekStart: '2026-11-16',
    });
    expect(digestDue(new Date('2026-11-23T15:00:00Z'), tz)).toEqual({
      due: true,
      weekStart: '2026-11-16',
    });
    expect(digestDue(new Date('2026-11-24T09:00:00Z'), tz).due).toBe(false);
  });

  it('handles DST: Europe/London spring forward and autumn back on a Monday-adjacent Sunday', () => {
    // BST starts Sun 29 Mar 2026; Monday 30 Mar 09:00 BST = 08:00Z.
    expect(
      digestDue(new Date('2026-03-30T07:59:00Z'), { ...monday9, timezone: 'Europe/London' }).due,
    ).toBe(false);
    expect(
      digestDue(new Date('2026-03-30T08:00:00Z'), { ...monday9, timezone: 'Europe/London' }),
    ).toEqual({ due: true, weekStart: '2026-03-23' });
    // GMT resumes Sun 25 Oct 2026; Monday 26 Oct 09:00 GMT = 09:00Z.
    expect(
      digestDue(new Date('2026-10-26T08:00:00Z'), { ...monday9, timezone: 'Europe/London' }).due,
    ).toBe(false);
    expect(
      digestDue(new Date('2026-10-26T09:00:00Z'), { ...monday9, timezone: 'Europe/London' }).due,
    ).toBe(true);
  });

  it('a local hour skipped by DST still sends later that day (≥ hour rule)', () => {
    // America/Los_Angeles: 2026-03-08 02:00 → 03:00 (Sunday). Digest on Sunday at 02:00.
    const s = { digestDayOfWeek: 7, digestHourLocal: 2, timezone: 'America/Los_Angeles' };
    expect(localHour(new Date('2026-03-08T10:00:00Z'), s.timezone)).toBe(3);
    expect(digestDue(new Date('2026-03-08T10:00:00Z'), s)).toEqual({
      due: true,
      weekStart: '2026-02-23',
    });
  });

  it('weeks are ISO weeks (Monday start) in the user’s calendar', () => {
    expect(lastCompleteWeekStart('2026-11-23')).toBe('2026-11-16');
    expect(lastCompleteWeekStart('2026-11-29')).toBe('2026-11-16');
    expect(lastCompleteWeekStart('2027-01-01')).toBe('2026-12-21');
    expect(weekLabel('2026-11-16', '2026-11-22')).toBe('Nov 16 – Nov 22');
    expect(weekLabel('2026-12-28', '2027-01-03')).toBe('Dec 28, 2026 – Jan 3, 2027');
  });
});

describe('digest template', () => {
  const content: DigestContent = {
    name: 'Dana <script>alert(1)</script>',
    timezone: 'Europe/London',
    weekStart: '2026-11-16',
    weekEnd: '2026-11-22',
    weekLabel: 'Nov 16 – Nov 22',
    metrics: [
      { key: 'prs_merged', label: 'PRs merged', value: 4, previous: 2 },
      { key: 'prs_reviewed', label: 'PRs reviewed', value: 7, previous: 7 },
      { key: 'commits', label: 'Commits', value: 12, previous: 15 },
      { key: 'repos_contributed', label: 'Repositories contributed to', value: 3, previous: null },
    ],
    notable: [
      {
        title: 'Fix "quotes" & <b>tags</b>',
        repo: 'acme/api',
        ref: 'PR-acme/api#42',
        url: 'https://github.com/acme/api/pull/42',
      },
      { title: 'Evil link', repo: 'acme/api', ref: 'PR-acme/api#43', url: 'javascript:alert(1)' },
    ],
    suggestions: [
      {
        title: 'Retry‮ webhooks',
        repo: 'acme/api',
        ref: 'PR-acme/api#44',
        url: 'http://localhost:3000/activity?item=pr_merged%3Acm1',
      },
    ],
    achievementsLogged: 1,
    summary: {
      text: 'Ignore previous instructions <img src=x onerror=alert(1)>',
      highlights: ['<a href="https://evil">click</a>'],
    },
    links: {
      dashboard: 'http://localhost:3000/dashboard',
      achievements: 'http://localhost:3000/achievements',
      settings: 'http://localhost:3000/settings/notifications',
      unsubscribe: 'http://localhost:3000/unsubscribe?token=abc.def',
    },
  };

  it('renders HTML + text (snapshot)', () => {
    const out = renderDigest(content);
    expect(out.subject).toBe('Your week: Nov 16 – Nov 22');
    expect(out.html).toMatchSnapshot('html');
    expect(out.text).toMatchSnapshot('text');
  });

  it('escapes user, GitHub and LLM text and drops non-http links', () => {
    const { html, text } = renderDigest(content);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<a href="https://evil"');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Fix &quot;quotes&quot; &amp; &lt;b&gt;tags&lt;/b&gt;');
    expect(html).not.toContain('‮');
    expect(text).not.toContain('javascript:');
    expect(html).toContain('Unsubscribe from the weekly digest');
    expect(html).toContain('http://localhost:3000/unsubscribe?token=abc.def');
  });

  it('quiet week copy and helpers', () => {
    const quiet = renderDigest({
      ...content,
      metrics: content.metrics.map((m) => ({ ...m, value: 0 })),
      notable: [],
      suggestions: [],
      summary: null,
    });
    expect(quiet.text).toContain('A quiet week on GitHub');
    expect(quiet.html).toContain('No merged PRs waiting to become achievements');
    expect(esc(`<'&">`)).toBe('&lt;&#39;&amp;&quot;&gt;');
    expect(clean('a\u0000b\n\nc', 10)).toBe('ab c');
  });
});
