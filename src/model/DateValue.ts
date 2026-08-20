import {
  type CalendarDate,
  calendarDateToISOString,
  isValidGregorianDate,
  parseCalendarDate,
} from "./CalendarDate.js";

/**
 * A date field's value as read from a task line. Malformed or out-of-range dates
 * (`📅 2026-13-45`) are captured as `invalid` rather than dropped or corrected — the
 * parser never "fixes" the user's file, it only reports what it found.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Model/DateValue.swift`, as a discriminated
 * union — the direct TS analogue of a Swift enum with associated values.
 */
export type DateValue = { readonly kind: "valid"; readonly date: CalendarDate } | { readonly kind: "invalid"; readonly raw: string };

/** Accepts `null` directly (a `ParsedTask` field that's absent entirely, e.g. no `📅` at
 * all) alongside a real `DateValue`, mirroring how Swift's `task.due?.calendarDate`
 * optional-chains through both "field absent" and "field present but invalid" in one
 * expression — TS has no equivalent chaining through a plain function call, so the
 * function itself accepts the wider type instead. */
export function dateValueCalendarDate(value: DateValue | null): CalendarDate | null {
  return value !== null && value.kind === "valid" ? value.date : null;
}

/** The exact text that appeared after the emoji marker, for either case. */
export function dateValueRawText(value: DateValue): string {
  return value.kind === "valid" ? calendarDateToISOString(value.date) : value.raw;
}

export function parseDateValue(raw: string): DateValue {
  const date = parseCalendarDate(raw);
  if (date === null || !isValidGregorianDate(date)) {
    return { kind: "invalid", raw };
  }
  return { kind: "valid", date };
}
