/**
 * A time of day with no date and no timezone, matching the granularity of the reminder
 * field's `HH:mm` component. Deliberately a separate type from `CalendarDate` rather than
 * folding an hour/minute pair into it — `CalendarDate` is date-only by design, matching
 * every other date field in the Obsidian Tasks format, and the reminder field is the one
 * place a time appears at all.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Model/ClockTime.swift`.
 */
export interface ClockTime {
  readonly hour: number;
  readonly minute: number;
}

export function compareClockTimes(a: ClockTime, b: ClockTime): number {
  if (a.hour !== b.hour) return a.hour - b.hour;
  return a.minute - b.minute;
}

/** True when `hour` is 0-23 and `minute` is 0-59. */
export function isValidClockTime(time: ClockTime): boolean {
  return time.hour >= 0 && time.hour <= 23 && time.minute >= 0 && time.minute <= 59;
}

const DIGITS_ONLY = /^\d+$/;

/**
 * Parses a strict `HH:mm` string (exactly 2+2 digits). Does not validate the range —
 * mirrors `parseCalendarDate`, which leaves range validation to the caller
 * (`ReminderValue`), so a shape-valid but out-of-range time like `25:99` is still
 * captured rather than rejected before it can be reported as invalid.
 */
export function parseClockTime(input: string): ClockTime | null {
  const parts = input.split(":");
  if (parts.length !== 2) return null;
  const [hourText, minuteText] = parts;
  if (hourText === undefined || minuteText === undefined) return null;
  if (hourText.length !== 2 || minuteText.length !== 2) return null;
  if (!DIGITS_ONLY.test(hourText) || !DIGITS_ONLY.test(minuteText)) return null;
  return { hour: Number(hourText), minute: Number(minuteText) };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Formats as `HH:mm`, zero-padded, matching the format the parser accepts. */
export function clockTimeToISOString(time: ClockTime): string {
  return `${pad2(time.hour)}:${pad2(time.minute)}`;
}
