import { describe, expect, it } from 'vitest';

import { safeCallback } from './safe-callback';

describe('safeCallback (sign-in redirect target)', () => {
  it('keeps same-site relative paths', () => {
    expect(safeCallback('/kpis?period=month:2026-10')).toBe('/kpis?period=month:2026-10');
  });

  it.each([
    undefined,
    '',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    'javascript:alert(1)',
  ])('falls back to / (which routes to onboarding or the dashboard) for %j', (value) => {
    expect(safeCallback(value)).toBe('/');
  });
});
