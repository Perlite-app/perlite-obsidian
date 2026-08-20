import type { CalendarDate } from "../model/CalendarDate.js";

/** The one place this plugin reads the system clock to answer "what day is it" — every
 * other function that reasons about dates takes `today` as an explicit parameter, the
 * same standing convention the native app's `CalendarDate.today` establishes. Uses the
 * device's local calendar day (`Date`'s own local-timezone getters), not UTC — pinning
 * to UTC would compute the wrong calendar day near midnight for a user outside UTC. */
export function todayCalendarDate(): CalendarDate {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}
