import { type CalendarDate } from "../model/CalendarDate.js";

/**
 * Pure month-grid arithmetic for the calendar lens (`view/CalendarBoard.ts`) — split out
 * of that DOM-rendering file specifically so this genuinely error-prone class of math
 * (weekday alignment, month rollover) is independently unit-testable, the same
 * pure-core/impure-shell split this codebase already applies everywhere else (e.g.
 * `CalendarIndex.ts` itself, or the native app's own `ReminderNotificationScheduler
 * .eligibleReminders`/`WidgetSnapshot.build`).
 *
 * Uses JS's own UTC-pinned `Date` (`Date.UTC`/`getUTC*`) purely as an arithmetic
 * coordinate system — never a local-timezone method — the same pattern (and the same
 * reason) `RecurrenceCalculator.ts`'s own `addDays`/weekday helpers already use.
 * Reimplemented locally rather than imported from there, since this is a `view/`-adjacent
 * concern (calendar-grid layout) with no real relationship to recurrence-rule evaluation.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dateFromCalendarDate(date: CalendarDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

function calendarDateFromDate(date: Date): CalendarDate {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function addDaysUTC(date: CalendarDate, days: number): CalendarDate {
  return calendarDateFromDate(new Date(dateFromCalendarDate(date).getTime() + days * MS_PER_DAY));
}

/** 0 = Sunday .. 6 = Saturday, matching `Date.getUTCDay()`'s own numbering. */
export function weekdayOf(date: CalendarDate): number {
  return dateFromCalendarDate(date).getUTCDay();
}

/** `date` is always day 1 of its month; this always returns day 1 of the month `delta`
 * months away — negative `delta` steps backward. Correct across year boundaries in both
 * directions (verified for December→January and January→December specifically, the two
 * cases a naive `month % 12` gets wrong without care). */
export function addMonths(date: CalendarDate, delta: number): CalendarDate {
  const totalMonths = date.year * 12 + (date.month - 1) + delta;
  const year = Math.floor(totalMonths / 12);
  const month = (((totalMonths % 12) + 12) % 12) + 1;
  return { year, month, day: 1 };
}

/** Always exactly 42 dates (6 full weeks), aligned so `firstWeekday` (0 = Sunday .. 6 =
 * Saturday) starts each row — matches the native `CalendarTabView.gridDates`'s own
 * "always 6 rows, never 5" shape (never a variable 5-or-6-row grid). */
export function gridDates(visibleMonth: CalendarDate, firstWeekday: number): CalendarDate[] {
  const leadingDays = (((weekdayOf(visibleMonth) - firstWeekday) % 7) + 7) % 7;
  const gridStart = addDaysUTC(visibleMonth, -leadingDays);
  const dates: CalendarDate[] = [];
  for (let offset = 0; offset < 42; offset++) dates.push(addDaysUTC(gridStart, offset));
  return dates;
}
