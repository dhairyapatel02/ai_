import { describe, expect, it } from 'vitest';

import { formatCount, formatDate, formatRelative, formatTime } from './format';

const NOW = new Date('2026-11-18T12:00:00Z');

describe('formatting (DESIGN_SYSTEM §6)', () => {
  it('formats counts with separators and unknown as an em dash', () => {
    expect(formatCount(1284)).toBe('1,284');
    expect(formatCount(null)).toBe('—');
  });

  it('formats dates without the year in the current year', () => {
    expect(formatDate('2026-11-09T10:00:00Z', { timeZone: 'UTC', now: NOW })).toBe('Nov 9');
    expect(formatDate('2025-11-09T10:00:00Z', { timeZone: 'UTC', now: NOW })).toBe('Nov 9, 2025');
  });

  it('uses 24-hour times in the user time zone', () => {
    expect(formatTime('2026-11-18T16:32:00Z', 'UTC')).toBe('16:32');
    expect(formatTime('2026-11-18T16:32:00Z', 'Asia/Tokyo')).toBe('01:32');
  });

  it('formats relative times', () => {
    expect(formatRelative('2026-11-18T11:59:30Z', { now: NOW })).toBe('just now');
    expect(formatRelative('2026-11-18T11:48:00Z', { now: NOW })).toBe('12 min ago');
    expect(formatRelative('2026-11-18T09:00:00Z', { now: NOW })).toBe('3 h ago');
    expect(formatRelative('2026-11-17T06:00:00Z', { now: NOW })).toBe('yesterday');
    expect(formatRelative('2026-11-01T06:00:00Z', { now: NOW, timeZone: 'UTC' })).toBe('Nov 1');
  });
});
