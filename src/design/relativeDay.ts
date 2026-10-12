import { calendarDateToISOString, compareCalendarDates, type CalendarDate } from "../model/CalendarDate.js";
import { addDaysUTC } from "../query/CalendarGrid.js";

/**
 * Day labels as every Perlite surface writes them — "Today", "Tomorrow", "Yesterday",
 * "Tue 13 Oct" — the same wording the native app's `RelativeDay` uses. `Intl` only, on
 * a UTC-pinned `Date` used purely as a calendar coordinate (the `CalendarGrid.ts`
 * convention), so the local timezone never shifts a day.
 */
export function relativeDayLabel(date: CalendarDate, today: CalendarDate): string {
  if (compareCalendarDates(date, today) === 0) return "Today";
  if (compareCalendarDates(date, addDaysUTC(today, 1)) === 0) return "Tomorrow";
  if (compareCalendarDates(date, addDaysUTC(today, -1)) === 0) return "Yesterday";
  return shortDayLabel(date);
}

/** "Tue 13 Oct". */
export function shortDayLabel(date: CalendarDate): string {
  const asDate = new Date(Date.UTC(date.year, date.month - 1, date.day));
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(asDate);
  const month = new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" }).format(asDate);
  return `${weekday} ${date.day} ${month}`;
}

/** "Friday, 9 October". */
export function longDayLabel(date: CalendarDate): string {
  const asDate = new Date(Date.UTC(date.year, date.month - 1, date.day));
  return new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(asDate);
}

export function isoDay(date: CalendarDate): string {
  return calendarDateToISOString(date);
}
