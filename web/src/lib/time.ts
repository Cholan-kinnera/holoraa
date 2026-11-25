/**
 * Compact timestamps for lists, in the style of messaging apps:
 * "now", "5m", "14:32" (today), "Yesterday", "Mon" (this week), "12 Mar", "12/03/2025".
 * Day boundaries use the viewer's local calendar. Invalid input gives "".
 */
export function formatRelativeTime(
  iso: string | null | undefined,
  now: Date = new Date(),
  locale?: string,
): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = now.getTime() - date.getTime();
  // Future timestamps (clock skew) read as "now".
  if (diffMs < 60_000) return "now";
  if (diffMs < 3_600_000 && isSameDay(date, now)) return `${Math.floor(diffMs / 60_000)}m`;

  const days = calendarDaysBetween(date, now);
  if (days === 0) {
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  if (days === 1) return "Yesterday";
  if (days < 7) return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
  if (date.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(date);
  }
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/** Full date and time, for a title or tooltip next to a compact timestamp. */
export function formatFullTimestamp(iso: string | null | undefined, locale?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function isSameDay(a: Date, b: Date): boolean {
  return calendarDaysBetween(a, b) === 0;
}

/** Whole local calendar days from `a` to `b` (0 = same day). DST-safe: compares midnights. */
function calendarDaysBetween(a: Date, b: Date): number {
  const startA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const startB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((startB - startA) / 86_400_000);
}
