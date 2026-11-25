const MONTH = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "2026-11" → "November 2026". */
export function monthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  return MONTH.format(new Date(Date.UTC(y!, m! - 1, 1)));
}

/** First name for the greeting: the display name, or nothing (never the email). */
export function greetingName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}
