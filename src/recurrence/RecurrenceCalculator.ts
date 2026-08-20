import { type CalendarDate, daysInMonth } from "../model/CalendarDate.js";
import type { RecurrenceRule } from "./RecurrenceRule.js";
import { weekdayFromRawValue, type Weekday } from "./Weekday.js";

/**
 * Computes the next occurrence of a `RecurrenceRule` after a reference date.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Recurrence/RecurrenceCalculator.swift`.
 * The Swift original converts `CalendarDate` to `Date` through a `Calendar` pinned to
 * UTC purely as an arithmetic coordinate system, leaning on `Calendar.date(byAdding:
 * value:to:)` for month/year math specifically because it clamps an out-of-range
 * resulting day to the last day of that month (Jan 31 + 1 month = Feb 28) rather than
 * overflowing into the next month — the exact leap-year bug farm a naive
 * `Date.setUTCMonth` rollover would produce. This port uses JS's own UTC-pinned `Date`
 * (`Date.UTC`/`getUTCFullYear` etc. — never a local-timezone method) as the same kind of
 * arithmetic coordinate system, but has to implement the clamping explicitly in
 * `addMonths`/`addYears` below, since `Date.setUTCMonth` overflows instead of clamping.
 */

function dateFromCalendarDate(date: CalendarDate): Date | null {
  const ms = Date.UTC(date.year, date.month - 1, date.day);
  return Number.isNaN(ms) ? null : new Date(ms);
}

function calendarDateFromDate(date: Date): CalendarDate | null {
  const ms = date.getTime();
  if (Number.isNaN(ms)) return null;
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function floorMod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Adds a whole number of days to a `CalendarDate`. Shared by the `"daily"` frequency
 * case below and by `RecurrenceEngine`, which uses it to shift secondary date fields
 * (`scheduled`/`start`) by the same delta the primary reference field moved. */
export function addDays(days: number, reference: CalendarDate): CalendarDate | null {
  const date = dateFromCalendarDate(reference);
  if (date === null) return null;
  return calendarDateFromDate(new Date(date.getTime() + days * MS_PER_DAY));
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

/** The earliest of `weekdays` strictly after `date`, stepping forward one day at a
 * time. `weekdays` is always non-empty when called (the parser never produces an empty
 * weekday list for a rule that specified `"on ..."`), so the loop always finds a match
 * within 7 iterations; it still returns `null` rather than looping forever if that
 * invariant were ever violated. */
function nextWeekdayAfter(date: Date, weekdays: ReadonlySet<Weekday>): Date | null {
  let candidate = date;
  for (let i = 0; i < 7; i++) {
    candidate = new Date(candidate.getTime() + MS_PER_DAY);
    const weekday = weekdayFromRawValue(candidate.getUTCDay() + 1);
    if (weekday !== null && weekdays.has(weekday)) {
      return candidate;
    }
  }
  return null;
}

/** The next date matching a single `weekday`. `includingReference` is what tells a bare
 * weekday name ("the nearest occurrence, today included if it already matches") apart
 * from an explicit `"next <weekday>"` ("skip today, give me the next one"), so it always
 * steps forward at least one day via the same `nextWeekdayAfter` loop the weekly-with-
 * weekdays case in `nextOccurrenceOfRule` below also uses. */
export function nextOccurrenceOfWeekday(weekday: Weekday, reference: CalendarDate, includingReference: boolean): CalendarDate | null {
  const referenceDate = dateFromCalendarDate(reference);
  if (referenceDate === null) return null;
  if (includingReference) {
    const referenceWeekday = weekdayFromRawValue(referenceDate.getUTCDay() + 1);
    if (referenceWeekday === weekday) return reference;
  }
  const next = nextWeekdayAfter(referenceDate, new Set([weekday]));
  return next === null ? null : calendarDateFromDate(next);
}

export function nextOccurrenceOfRule(rule: RecurrenceRule, reference: CalendarDate): CalendarDate | null {
  const referenceDate = dateFromCalendarDate(reference);
  if (referenceDate === null) return null;

  switch (rule.frequency) {
    case "daily":
      return addDays(rule.interval, reference);
    case "weekly": {
      if (rule.weekdays.length > 0) {
        const next = nextWeekdayAfter(referenceDate, new Set(rule.weekdays));
        return next === null ? null : calendarDateFromDate(next);
      }
      return calendarDateFromDate(new Date(referenceDate.getTime() + rule.interval * 7 * MS_PER_DAY));
    }
    case "monthly":
      return addMonths(rule.interval, reference);
    case "yearly":
      return addYears(rule.interval, reference);
  }
}

/** Whole-day difference between two dates, used to shift secondary date fields
 * (`scheduled`/`start`) by the same amount the primary reference field moved. */
export function daysBetween(start: CalendarDate, end: CalendarDate): number | null {
  const startDate = dateFromCalendarDate(start);
  const endDate = dateFromCalendarDate(end);
  if (startDate === null || endDate === null) return null;
  return Math.round((endDate.getTime() - startDate.getTime()) / MS_PER_DAY);
}
