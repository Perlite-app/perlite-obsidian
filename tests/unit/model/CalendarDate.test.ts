import { describe, expect, test } from "vitest";
import { calendarDateToISOString, compareCalendarDates, isValidGregorianDate, parseCalendarDate } from "../../../src/model/CalendarDate.js";

describe("parseCalendarDate", () => {
  test("parses a well-formed date", () => {
    expect(parseCalendarDate("2026-08-13")).toEqual({ year: 2026, month: 8, day: 13 });
  });

  test("rejects wrong segment lengths", () => {
    expect(parseCalendarDate("26-8-13")).toBeNull();
    expect(parseCalendarDate("2026-8-13")).toBeNull();
  });

  test("rejects wrong segment count", () => {
    expect(parseCalendarDate("2026-08")).toBeNull();
    expect(parseCalendarDate("2026-08-13-01")).toBeNull();
  });

  test("rejects non-digit segments", () => {
    expect(parseCalendarDate("2026-0a-13")).toBeNull();
  });

  test("does not validate day-for-month — that's isValidGregorianDate's job", () => {
    expect(parseCalendarDate("2026-02-30")).toEqual({ year: 2026, month: 2, day: 30 });
  });
});

describe("isValidGregorianDate", () => {
  test("accepts an ordinary date", () => {
    expect(isValidGregorianDate({ year: 2026, month: 8, day: 13 })).toBe(true);
  });

  test("rejects month 0 and month 13", () => {
    expect(isValidGregorianDate({ year: 2026, month: 0, day: 1 })).toBe(false);
    expect(isValidGregorianDate({ year: 2026, month: 13, day: 1 })).toBe(false);
  });

  test("rejects day 0", () => {
    expect(isValidGregorianDate({ year: 2026, month: 1, day: 0 })).toBe(false);
  });

  test("rejects Feb 30", () => {
    expect(isValidGregorianDate({ year: 2026, month: 2, day: 30 })).toBe(false);
  });

  test("leap year: accepts Feb 29 in a leap year, rejects otherwise", () => {
    expect(isValidGregorianDate({ year: 2024, month: 2, day: 29 })).toBe(true);
    expect(isValidGregorianDate({ year: 2026, month: 2, day: 29 })).toBe(false);
  });

  test("century leap-year rule: 1900 is not a leap year, 2000 is", () => {
    expect(isValidGregorianDate({ year: 1900, month: 2, day: 29 })).toBe(false);
    expect(isValidGregorianDate({ year: 2000, month: 2, day: 29 })).toBe(true);
  });

  test("accepts the last day of 30-day and 31-day months", () => {
    expect(isValidGregorianDate({ year: 2026, month: 4, day: 30 })).toBe(true);
    expect(isValidGregorianDate({ year: 2026, month: 4, day: 31 })).toBe(false);
    expect(isValidGregorianDate({ year: 2026, month: 1, day: 31 })).toBe(true);
  });
});

describe("calendarDateToISOString", () => {
  test("zero-pads month and day", () => {
    expect(calendarDateToISOString({ year: 2026, month: 8, day: 3 })).toBe("2026-08-03");
  });

  test("round-trips through parseCalendarDate", () => {
    const date = { year: 99, month: 1, day: 1 };
    expect(parseCalendarDate(calendarDateToISOString(date))).toEqual(date);
  });
});

describe("compareCalendarDates", () => {
  test("orders by year, then month, then day", () => {
    expect(compareCalendarDates({ year: 2026, month: 1, day: 1 }, { year: 2027, month: 1, day: 1 })).toBeLessThan(0);
    expect(compareCalendarDates({ year: 2026, month: 2, day: 1 }, { year: 2026, month: 1, day: 1 })).toBeGreaterThan(0);
    expect(compareCalendarDates({ year: 2026, month: 1, day: 5 }, { year: 2026, month: 1, day: 5 })).toBe(0);
  });
});
