/**
 * Calendar helpers pinned to the household timezone (Asia/Manila, UTC+8, no
 * daylight saving). Computing from a fixed offset keeps results identical on
 * the server (which runs in UTC) and on every device, whatever its timezone.
 * See docs/PLAN.md §0 C2 and §6.11.
 */

export const HOUSEHOLD_TIMEZONE = 'Asia/Manila' as const;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** A calendar date with no time, e.g. "2026-11-23". */
export type IsoDate = string;
/** A calendar month, e.g. "2026-11". */
export type YearMonth = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_MONTH = /^(\d{4})-(\d{2})$/;

/** Today's date in Manila for the given instant. */
export function manilaDate(now: Date): IsoDate {
  if (Number.isNaN(now.getTime())) throw new RangeError('Invalid Date');
  return new Date(now.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m.map(Number) as [number, number, number, number];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

function assertIsoDate(value: string): void {
  if (!isValidIsoDate(value)) throw new RangeError(`Invalid ISO date: ${value}`);
}

/** "2026-11-23" → "2026-11" */
export function yearMonthOf(date: IsoDate): YearMonth {
  assertIsoDate(date);
  return date.slice(0, 7);
}

/** Adds (or subtracts) whole days. */
export function addDays(date: IsoDate, days: number): IsoDate {
  assertIsoDate(date);
  if (!Number.isInteger(days)) throw new RangeError('days must be an integer');
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Yesterday in Manila for the given instant (used by the 7 AM summary). */
export function manilaYesterday(now: Date): IsoDate {
  return addDays(manilaDate(now), -1);
}

/** month is 1–12 */
export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Invalid year/month: ${year}-${month}`);
  }
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Date a fixed monthly transaction posts in the given month. Days 29–31 clamp
 * to the month's last day, e.g. day 31 in February 2027 → "2027-02-28".
 */
export function fixedPostingDate(yearMonth: YearMonth, dayOfMonth: number): IsoDate {
  const m = YEAR_MONTH.exec(yearMonth);
  if (!m) throw new RangeError(`Invalid year-month: ${yearMonth}`);
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    throw new RangeError(`dayOfMonth must be 1–31, got ${dayOfMonth}`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Math.min(dayOfMonth, daysInMonth(year, month));
  return `${yearMonth}-${String(day).padStart(2, '0')}`;
}
