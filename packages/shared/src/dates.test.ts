import { describe, expect, it } from 'vitest';

import {
  addDays,
  daysInMonth,
  fixedPostingDate,
  isValidIsoDate,
  manilaDate,
  manilaYesterday,
  yearMonthOf,
} from './dates';

describe('manilaDate', () => {
  it('uses Manila time, not UTC: 23:00 UTC is already the next day in Manila', () => {
    expect(manilaDate(new Date('2026-11-22T23:00:00Z'))).toBe('2026-11-23');
  });

  it('stays on the same day before 16:00 UTC', () => {
    expect(manilaDate(new Date('2026-11-23T15:59:59Z'))).toBe('2026-11-23');
  });

  it('rejects an invalid Date', () => {
    expect(() => manilaDate(new Date('nope'))).toThrow(RangeError);
  });
});

describe('manilaYesterday (7 AM summary)', () => {
  it('7:00 AM Manila (23:00 UTC the day before) reports the previous Manila day', () => {
    // Cron fires at 23:00 UTC on 22 Nov = 07:00 Manila on 23 Nov → yesterday is 22 Nov.
    expect(manilaYesterday(new Date('2026-11-22T23:00:00Z'))).toBe('2026-11-22');
  });

  it('on the 1st of the month, yesterday is the last day of the previous month', () => {
    expect(manilaYesterday(new Date('2026-11-30T23:00:00Z'))).toBe('2026-11-30');
    expect(manilaYesterday(new Date('2026-12-31T23:00:00Z'))).toBe('2026-12-31');
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it.each([
    ['2026-13-01', 1],
    ['2026-02-30', 1],
    ['not-a-date', 1],
    ['2026-11-23', 1.5],
  ])('rejects %j / %s', (date, days) => {
    expect(() => addDays(date, days)).toThrow(RangeError);
  });
});

describe('isValidIsoDate / yearMonthOf', () => {
  it('accepts real dates including leap day', () => {
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(yearMonthOf('2026-11-23')).toBe('2026-11');
  });

  it.each(['2027-02-29', '2026-04-31', '2026-00-10', '26-11-23', '2026/11/23', ''])(
    'rejects %j',
    (value) => {
      expect(isValidIsoDate(value)).toBe(false);
      expect(() => yearMonthOf(value)).toThrow(RangeError);
    },
  );
});

describe('daysInMonth', () => {
  it('knows month lengths and leap years', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 11)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it.each([
    [2026, 0],
    [2026, 13],
    [2026.5, 1],
  ])('rejects %s-%s', (y, m) => {
    expect(() => daysInMonth(y, m)).toThrow(RangeError);
  });
});

describe('fixedPostingDate', () => {
  it('posts on the chosen day', () => {
    expect(fixedPostingDate('2026-11', 15)).toBe('2026-11-15');
    expect(fixedPostingDate('2026-11', 1)).toBe('2026-11-01');
  });

  it('clamps days 29–31 to the end of shorter months', () => {
    expect(fixedPostingDate('2027-02', 31)).toBe('2027-02-28');
    expect(fixedPostingDate('2028-02', 30)).toBe('2028-02-29');
    expect(fixedPostingDate('2026-11', 31)).toBe('2026-11-30');
  });

  it.each([
    ['2026-11', 0],
    ['2026-11', 32],
    ['2026-11', 1.5],
    ['2026-13', 5],
    ['Nov 2026', 5],
  ])('rejects %j day %s', (ym, day) => {
    expect(() => fixedPostingDate(ym, day)).toThrow(RangeError);
  });
});
