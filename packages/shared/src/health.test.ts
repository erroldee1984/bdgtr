import { describe, expect, it } from 'vitest';

import { HealthResponseSchema } from './health';

describe('HealthResponseSchema', () => {
  it('accepts a valid health response', () => {
    const value = { status: 'ok', service: 'bdgtr-api', time: '2026-11-23T05:00:00.000Z' };
    expect(HealthResponseSchema.parse(value)).toEqual(value);
  });

  it.each([
    { status: 'down', service: 'bdgtr-api', time: '2026-11-23T05:00:00.000Z' },
    { status: 'ok', service: 'other', time: '2026-11-23T05:00:00.000Z' },
    { status: 'ok', service: 'bdgtr-api', time: 'yesterday' },
    { status: 'ok' },
    null,
  ])('rejects %j', (value) => {
    expect(HealthResponseSchema.safeParse(value).success).toBe(false);
  });
});
