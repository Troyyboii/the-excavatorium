const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DISPLAY_LOCALE = "en-GB";

type DateParts = {
  day: string;
  month: string;
  year: string;
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
  return { day: pad(day), month: pad(month), year: pad(year % 100) };
}

function parseDateOnly(value: string): DateParts | null | undefined {
  const match = DATE_ONLY_RE.exec(value);
  if (!match) return undefined;
  return dateParts(Number(match[1]), Number(match[2]), Number(match[3]));
}

function formatDateParts(parts: DateParts): string {
  return `${parts.day}/${parts.month}/${parts.year}`;
}

/**
 * Formats archive dates as DD/MM/YY, with local viewer time for timestamps.
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
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(({ type, value: partValue }) => [type, partValue]),
  );
  return `${parts.day}/${parts.month}/${parts.year}`;
}

/** Formats archive timestamps as DD/MM/YY, HH:mm in the viewer's local timezone. */
export function formatArchiveDateTime(
  value: string | number | null | undefined,
  timeZone?: string,
): string {
  if (value === null || value === undefined || value === "") return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const formatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(timeZone ? { timeZone } : {}),
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(({ type, value: partValue }) => [type, partValue]),
  );
  return `${parts.day}/${parts.month}/${parts.year}, ${parts.hour}:${parts.minute}`;
}

/** Formats a calendar day for stable, locale-independent data attributes. */
export function formatCalendarDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  return formatDateParts({
    day: pad(date.getDate()),
    month: pad(date.getMonth() + 1),
    year: pad(date.getFullYear() % 100),
  });
}

/** Formats a calendar month abbreviation in English. */
export function formatMonthShort(date: Date): string {
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, { month: "short" }).format(date);
}
