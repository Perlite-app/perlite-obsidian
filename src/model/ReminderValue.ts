import { type CalendarDate, calendarDateToISOString, isValidGregorianDate, parseCalendarDate } from "./CalendarDate.js";
import { type ClockTime, clockTimeToISOString, isValidClockTime, parseClockTime } from "./ClockTime.js";

/**
 * The `⏰` reminder field's value as read from a task line: `⏰ YYYY-MM-DD` or
 * `⏰ YYYY-MM-DD HH:mm`. Mirrors `DateValue`'s valid/invalid split — a malformed or
 * out-of-range reminder is captured as `invalid` rather than dropped or corrected.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Model/ReminderValue.swift`. The time is
 * optional — a bare `⏰ YYYY-MM-DD` (written by another tool, or by hand) is a valid
 * reminder date with no specific time, not an error.
 */
export type ReminderValue =
  | { readonly kind: "valid"; readonly date: CalendarDate; readonly time: ClockTime | null }
  | { readonly kind: "invalid"; readonly raw: string };

export function reminderValueCalendarDate(value: ReminderValue): CalendarDate | null {
  return value.kind === "valid" ? value.date : null;
}

export function reminderValueClockTime(value: ReminderValue): ClockTime | null {
  return value.kind === "valid" ? value.time : null;
}

/** The exact text that appeared after the emoji marker, for either case. */
export function reminderValueRawText(value: ReminderValue): string {
  if (value.kind === "invalid") return value.raw;
  return value.time === null
    ? calendarDateToISOString(value.date)
    : `${calendarDateToISOString(value.date)} ${clockTimeToISOString(value.time)}`;
}

/**
 * `raw` is the value token as captured by `LineScanner` (Wave 1 chunk 2) — either just
 * the date, or the date and time joined by a single space.
 */
export function parseReminderValue(raw: string): ReminderValue {
  const parts = raw.split(" ").filter((part) => part.length > 0);
  if (parts.length !== 1 && parts.length !== 2) {
    return { kind: "invalid", raw };
  }
  const [dateText, timeText] = parts;
  if (dateText === undefined) {
    return { kind: "invalid", raw };
  }
  const date = parseCalendarDate(dateText);
  if (date === null || !isValidGregorianDate(date)) {
    return { kind: "invalid", raw };
  }
  if (timeText === undefined) {
    return { kind: "valid", date, time: null };
  }
  const time = parseClockTime(timeText);
  if (time === null || !isValidClockTime(time)) {
    return { kind: "invalid", raw };
  }
  return { kind: "valid", date, time };
}
