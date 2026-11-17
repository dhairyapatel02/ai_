import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Static guard for multi-tenancy (ARCHITECTURE_V2 §12): every Prisma call on a user-owned model in
 * `src/` must filter or write by `userId`. Deliberate exceptions carry a `user-scope:` comment on
 * one of the two preceding lines explaining why the call is safe (e.g. the row was loaded by
 * `{ id, userId }` just before). New code that forgets the filter fails this test.
 */
const USER_OWNED = [
  'integration',
  'commit',
  'pullRequest',
  'issue',
  'repository',
  'pullRequestReview',
  'syncRun',
  'generatedDocument',
  'impactScore',
  'impactScoreLegacy',
  'metricSnapshot',
  'userSettings',
  'aiUsage',
  // No userId column: every access must follow a `{ id, userId }` document lookup (justified).
  'documentVersion',
];
const SRC = path.resolve(__dirname, '../../src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
  });
}

/** Text of the balanced `( … )` argument list starting at `open`. */
function argsAt(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')' && --depth === 0) return source.slice(open, i + 1);
  }
  return source.slice(open);
}

describe('user scoping of Prisma queries (static check)', () => {
  const pattern = new RegExp(`\\b(?:prisma|tx)\\.(${USER_OWNED.join('|')})\\.(\\w+)\\(`, 'g');

  it('finds the queries it is meant to check', () => {
    const total = files(SRC).reduce(
      (n, file) => n + [...readFileSync(file, 'utf8').matchAll(pattern)].length,
      0,
    );
    expect(total).toBeGreaterThan(20);
  });

  it('every query on a user-owned model is scoped by userId (or justified)', () => {
    const offenders: string[] = [];
    for (const file of files(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(pattern)) {
        const start = match.index;
        const args = argsAt(source, start + match[0].length - 1);
        if (/\buserId\b/.test(args)) continue;
        const before = source.slice(0, start).split('\n').slice(-3).join('\n');
        if (before.includes('user-scope:')) continue;
        const line = source.slice(0, start).split('\n').length;
        offenders.push(`${path.relative(SRC, file)}:${line} ${match[1]}.${match[2]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
