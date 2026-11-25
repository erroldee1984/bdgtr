import { describe, expect, it } from 'vitest';

import { displayName } from './auth.js';

describe('displayName (optional `name` session claim)', () => {
  it('trims and collapses whitespace', () => {
    expect(displayName('  Ana   Dela  Cruz ')).toBe('Ana Dela Cruz');
    expect(displayName('José Rizal')).toBe('José Rizal');
  });

  it.each([
    ['missing', undefined],
    ['not a string', 42],
    ['an object', { first: 'Ana' }],
    ['empty', '   '],
    ['too long', 'x'.repeat(101)],
    ['control characters', 'Ana\u0000Cruz'],
    ['a template Clerk left unfilled is still just text, kept short', 'x'.repeat(200)],
  ])('ignores %s', (_label, raw) => {
    expect(displayName(raw)).toBeNull();
  });
});
