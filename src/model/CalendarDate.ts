/**
 * A calendar date with no time-of-day and no timezone, matching the granularity of every
 * date field in the Obsidian Tasks format (`YYYY-MM-DD`). Modelling these as `Date` would
 * invite off-by-one-day bugs at timezone boundaries; conversion to `Date` happens only at
 * the UI/filter boundary with an explicit calendar/timezone.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Model/CalendarDate.swift`. Ported as a
 * plain readonly data shape plus free functions, not a class — this whole `model/`
 * layer is functional-core-style on the TS side (Swift's value-type structs map more
 * naturally to that than to classes here), a deliberate divergence in *style* only; the
 * field shapes and behaviour are kept field-for-field identical to the Swift original.
 */
export interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export function compareCalendarDates(a: CalendarDate, b: CalendarDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Exported for `RecurrenceCalculator`'s month/year-addition clamping (Jan 31 + 1 month
 * = Feb 28, not an overflow into March) — shares this one leap-year-aware
 * implementation rather than duplicating it. */
export function daysInMonth(month: number, year: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      return 0;
  }
}

/** True when this is a real date on the proleptic Gregorian calendar (valid month 1-12,
 * day within that month's length, accounting for leap years). */
export function isValidGregorianDate(date: CalendarDate): boolean {
  if (date.month < 1 || date.month > 12 || date.day < 1) return false;
  return date.day <= daysInMonth(date.month, date.year);
}

const DIGITS_ONLY = /^\d+$/;

/**
 * Parses a strict `YYYY-MM-DD` string. Does not validate that the day is valid for the
 * month (e.g. `2026-02-30` parses successfully) — that judgement belongs to `DateValue`,
 * which decides whether an out-of-range date is invalid while still preserving the raw
 * text verbatim.
 *
 * Deliberate narrow divergence from the Swift original: Swift's `Int(String)` accepts an
 * optional leading `+`/`-` sign; this only requires digits. Not believed to affect any
 * real fixture — a signed 4-digit year group is not a shape any conformance fixture (or
 * realistic vault content) uses, and `split("-")` on a leading `-` already produces more
 * than 3 parts on both sides, rejecting the input before signedness would even matter.
 */
export function parseCalendarDate(input: string): CalendarDate | null {
  const parts = input.split("-");
  if (parts.length !== 3) return null;
  const [yearText, monthText, dayText] = parts;
  if (yearText === undefined || monthText === undefined || dayText === undefined) return null;
  if (yearText.length !== 4 || monthText.length !== 2 || dayText.length !== 2) return null;
  if (!DIGITS_ONLY.test(yearText) || !DIGITS_ONLY.test(monthText) || !DIGITS_ONLY.test(dayText)) {
    return null;
  }
  return { year: Number(yearText), month: Number(monthText), day: Number(dayText) };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** Formats as `YYYY-MM-DD`, zero-padded, matching the format the parser accepts. */
export function calendarDateToISOString(date: CalendarDate): string {
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}
