import { compareCalendarDates, type CalendarDate } from "../model/CalendarDate.js";
import { dateValueCalendarDate } from "../model/DateValue.js";
import type { ParsedTask } from "../model/ParsedTask.js";

/**
 * Whether `task` belongs in `PerliteListView`'s optional "Completed" segment: done,
 * with a `done` date equal to `today`. Deliberately checks `done`, never falling back
 * to `due`/`scheduled`/`start` the way `defaultSegments.ts`'s four segments do for an
 * *incomplete* task — "completed today" means the day the task was actually finished,
 * not whatever date it happened to be due.
 *
 * **Not a port of anything in `PerliteCore`** — the native app's own `DefaultListView`/
 * `ContentView` have no completed-tasks toggle to mirror (confirmed by inspection,
 * 2026-08-24), so this is a plugin-only addition, kept out of `defaultSegments.ts`
 * (whose own doc comment frames it as a strict 1:1 port of the Swift original) rather
 * than added there as a fifth segment.
 */
export function isCompletedToday(task: ParsedTask, today: CalendarDate): boolean {
  if (task.status.kind !== "done") return false;
  const doneDate = dateValueCalendarDate(task.done);
  return doneDate !== null && compareCalendarDates(doneDate, today) === 0;
}
