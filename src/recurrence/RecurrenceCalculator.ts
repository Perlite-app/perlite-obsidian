import { type CalendarDate, daysInMonth } from "../model/CalendarDate.js";
import type { RecurrenceRule } from "./RecurrenceRule.js";
import { weekdayFromRawValue, type Weekday } from "./Weekday.js";

/**
 * Computes the next occurrence of a `RecurrenceRule` after a reference date.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Recurrence/RecurrenceCalculator.swift`.
 * Both work on whole day numbers (days since 1970-01-01) on the proleptic Gregorian
 * calendar — the calendar the Tasks plugin's moment.js uses — rather than on `Date`:
 * `Date.UTC` maps years 0–99 to 1900–1999, which sent a recurrence from `0001-01-01` to
 * `1901-…` (found by the conformance corpus's differential fuzzing), and Swift's
 * Foundation `Calendar` turns Julian before 1582. Month and year steps clamp the day to
 * the target month's length (Jan 31 + 1 month = Feb 28) in year/month integer space.
 */

/** Days since 1970-01-01 (Howard Hinnant's `days_from_civil`). A day past the end of
 * its month (`2026-02-30`) simply runs on into the next month. */
export function dayNumber(date: CalendarDate): number {
  const year = date.month <= 2 ? date.year - 1 : date.year;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const dayOfYear = Math.floor((153 * (date.month + (date.month > 2 ? -3 : 9)) + 2) / 5) + date.day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** The inverse of `dayNumber` (`civil_from_days`). */
export function calendarDateFromDayNumber(dayNumber: number): CalendarDate {
  const z = dayNumber + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
  const month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
  return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

function floorMod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

/** 1970-01-01 was a Thursday; `Weekday` raw values run 1 = Sunday ... 7 = Saturday. */
function weekdayOfDayNumber(day: number): Weekday | null {
  return weekdayFromRawValue(floorMod(day + 4, 7) + 1);
}

/** Adds a whole number of days to a `CalendarDate`. Shared by the `"daily"` frequency
 * case below and by `RecurrenceEngine`, which uses it to shift secondary date fields
 * (`scheduled`/`start`) by the same delta the primary reference field moved. */
export function addDays(days: number, reference: CalendarDate): CalendarDate | null {
  return calendarDateFromDayNumber(dayNumber(reference) + days);
}

/** Adds whole months, clamping the day to the target month's length rather than
 * overflowing into the following month (Jan 31 + 1 month = Feb 28). Computed in
 * year/month integer space, not via `Date` rollover, specifically to make that
 * clamping exact and independent of `Date`'s own overflow behaviour. */
function addMonths(months: number, reference: CalendarDate): CalendarDate | null {
  const totalMonths = reference.year * 12 + (reference.month - 1) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = floorMod(totalMonths, 12) + 1;
  const clampedDay = Math.min(reference.day, daysInMonth(targetMonth, targetYear));
  return { year: targetYear, month: targetMonth, day: clampedDay };
}

/** Adds whole years, clamping Feb 29 to Feb 28 when the target year isn't a leap year —
 * the one case a same month/day can fail to exist a year later. */
function addYears(years: number, reference: CalendarDate): CalendarDate | null {
  const targetYear = reference.year + years;
  const clampedDay = Math.min(reference.day, daysInMonth(reference.month, targetYear));
  return { year: targetYear, month: reference.month, day: clampedDay };
}

/** The earliest of `weekdays` strictly after `day`, stepping forward one day at a
 * time. `weekdays` is always non-empty when called (the parser never produces an empty
 * weekday list for a rule that specified `"on ..."`), so the loop always finds a match
 * within 7 iterations; it still returns `null` rather than looping forever if that
 * invariant were ever violated. */
function nextWeekdayAfter(day: number, weekdays: ReadonlySet<Weekday>): CalendarDate | null {
  for (let offset = 1; offset <= 7; offset++) {
    const weekday = weekdayOfDayNumber(day + offset);
    if (weekday !== null && weekdays.has(weekday)) return calendarDateFromDayNumber(day + offset);
  }
  return null;
}

/** The next date matching a single `weekday`. `includingReference` is what tells a bare
 * weekday name ("the nearest occurrence, today included if it already matches") apart
 * from an explicit `"next <weekday>"` ("skip today, give me the next one"), so it always
 * steps forward at least one day via the same `nextWeekdayAfter` loop the weekly-with-
 * weekdays case in `nextOccurrenceOfRule` below also uses. */
export function nextOccurrenceOfWeekday(weekday: Weekday, reference: CalendarDate, includingReference: boolean): CalendarDate | null {
  const referenceDay = dayNumber(reference);
  if (includingReference && weekdayOfDayNumber(referenceDay) === weekday) return reference;
  return nextWeekdayAfter(referenceDay, new Set([weekday]));
}

export function nextOccurrenceOfRule(rule: RecurrenceRule, reference: CalendarDate): CalendarDate | null {
  switch (rule.frequency) {
    case "daily":
      return addDays(rule.interval, reference);
    case "weekly":
      if (rule.weekdays.length > 0) return nextWeekdayAfter(dayNumber(reference), new Set(rule.weekdays));
      return addDays(rule.interval * 7, reference);
    case "monthly":
      return addMonths(rule.interval, reference);
    case "yearly":
      return addYears(rule.interval, reference);
  }
}

/** Whole-day difference between two dates, used to shift secondary date fields
 * (`scheduled`/`start`) by the same amount the primary reference field moved. */
export function daysBetween(start: CalendarDate, end: CalendarDate): number | null {
  return dayNumber(end) - dayNumber(start);
}
