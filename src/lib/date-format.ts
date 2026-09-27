const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DISPLAY_LOCALE = "en-GB";
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

type DateParts = {
  day: number;
  month: number;
  year: number;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dateParts(year: number, month: number, day: number): DateParts | null {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return { day, month, year };
}

function parseDateOnly(value: string): DateParts | null | undefined {
  const match = DATE_ONLY_RE.exec(value);
  if (!match) return undefined;
  return dateParts(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** Canonical Night Crypt visible date: `22 Sep 2026`. */
function formatDateParts(parts: DateParts): string {
  return `${parts.day} ${MONTHS_SHORT[parts.month - 1]} ${parts.year}`;
}

/**
 * Formats archive dates as `22 Sep 2026`, with local viewer time for timestamps.
 * Date-only values are kept as calendar dates and never parsed through UTC.
 */
export function formatArchiveDate(value: string | null | undefined, timeZone?: string): string {
  if (!value) return "Not recorded";

  const dateOnly = parseDateOnly(value);
  if (dateOnly !== undefined) {
    return dateOnly ? formatDateParts(dateOnly) : value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const formatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(timeZone ? { timeZone } : {}),
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(({ type, value: partValue }) => [type, partValue]),
  );
  return `${Number(parts.day)} ${parts.month} ${parts.year}`;
}

/** Formats archive timestamps as `22 Sep 2026, 08:48` in the viewer's local timezone. */
export function formatArchiveDateTime(
  value: string | number | null | undefined,
  timeZone?: string,
): string {
  if (value === null || value === undefined || value === "") return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const formatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(timeZone ? { timeZone } : {}),
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(({ type, value: partValue }) => [type, partValue]),
  );
  return `${Number(parts.day)} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute}`;
}

/**
 * Formats a calendar day for stable, locale-independent data attributes.
 * Numeric DD/MM/YY — not the visible archive presentation.
 */
export function formatCalendarDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${pad(date.getFullYear() % 100)}`;
}

/** Formats a calendar month abbreviation in English. */
export function formatMonthShort(date: Date): string {
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, { month: "short" }).format(date);
}
