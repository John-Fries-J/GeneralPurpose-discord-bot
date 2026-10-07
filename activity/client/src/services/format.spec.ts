import { describe, expect, it } from 'vitest';
import { clamp, formatDuration, initials } from './format';

describe('format helpers', () => {
  it('formats track durations', () => {
    expect(formatDuration(0)).toBe('--:--');
    expect(formatDuration(65_000)).toBe('1:05');
  });

  it('clamps numeric values', () => {
    expect(clamp(250, 0, 200)).toBe(200);
    expect(clamp(-5, 0, 200)).toBe(0);
  });

  it('builds compact initials', () => {
    expect(initials('Marsden Sterling')).toBe('MS');
  });
});
