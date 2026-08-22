import { describe, expect, test } from "bun:test";
import {
  formatArchiveDate,
  formatArchiveDateTime,
  formatCalendarDate,
  formatMonthShort,
} from "./date-format";

describe("archive date formatting", () => {
  test("formats date-only values without timezone conversion", () => {
    expect(formatArchiveDate("2026-08-05")).toBe("05/08/26");
    expect(formatArchiveDate("2024-02-29")).toBe("29/02/24");
  });

  test("rejects impossible date-only values instead of normalizing them", () => {
    expect(formatArchiveDate("2026-02-30")).toBe("2026-02-30");
  });

  test("formats timestamps with an explicit 24-hour clock", () => {
    expect(formatArchiveDateTime("2026-08-22T08:48:00.000Z", "UTC")).toBe("22/08/26, 08:48");
    expect(formatArchiveDateTime("2026-08-22T23:07:00.000Z", "UTC")).toBe("22/08/26, 23:07");
    expect(formatArchiveDateTime("2026-08-22T08:48:00.000Z", "Europe/Zagreb")).toBe(
      "22/08/26, 10:48",
    );
  });

  test("preserves the existing empty and invalid-value fallback contract", () => {
    expect(formatArchiveDate(null)).toBe("Not recorded");
    expect(formatArchiveDate("")).toBe("Not recorded");
    expect(formatArchiveDate("not-a-date")).toBe("not-a-date");
    expect(formatArchiveDateTime("not-a-date")).toBe("not-a-date");
  });

  test("formats calendar helpers in English and stable numeric form", () => {
    expect(formatCalendarDate(new Date(2026, 7, 5))).toBe("05/08/26");
    expect(formatMonthShort(new Date("2026-08-05T00:00:00Z"))).toBe("Aug");
    expect(formatMonthShort(new Date("2026-08-05T00:00:00Z"))).not.toMatch(/kol|srp/i);
  });
});
