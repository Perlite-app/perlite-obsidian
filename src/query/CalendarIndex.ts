import { calendarDateToISOString, compareCalendarDates, type CalendarDate } from "../model/CalendarDate.js";
import type { ParsedTask } from "../model/ParsedTask.js";

/**
 * Wave 3's calendar lens: which day a task belongs on, and the "what's overdue right
 * now" list its agenda's own "Overdue" section needs. Kept as pure, Obsidian-free
 * logic — no `HTMLElement`, no vault access — so it's directly unit-testable the same
 * way every other `query/` file already is.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Query/CalendarIndex.swift`.
 */

/** A task's calendar-tab day: `due` if the field is present at all, else `scheduled` if
 * valid, else `null`. `start` is deliberately never consulted — it means "don't work on
 * before," not "do it on," so anchoring a task there would misrepresent it.
 *
 * The load-bearing subtlety: this branches on *presence* of the `due` field, not on
 * `due` yielding a valid date. `task.due !== null` and `.kind === "invalid"` (a
 * malformed `📅 2026-13-45`) still returns `null` here rather than falling through to
 * `scheduled` — a malformed due date must not be silently masked by a valid scheduled
 * one. `dateValueCalendarDate(task.due) ?? dateValueCalendarDate(task.scheduled)` would
 * get this wrong: it collapses "no due field at all" and "due field present but
 * invalid" to the same `null` and always falls through in both cases. */
export function anchorDate(task: ParsedTask): CalendarDate | null {
  if (task.due !== null) {
    return task.due.kind === "valid" ? task.due.date : null;
  }
  return task.scheduled !== null && task.scheduled.kind === "valid" ? task.scheduled.date : null;
}

/** Buckets every task with a resolvable anchor date by that date (ISO string key, since
 * a `Map` can't key by `CalendarDate` structural equality — same trick
 * `GroupingEngine.groupByDueDate` already uses). A task with no anchor is skipped, never
 * bucketed under a sentinel. Single pass, mirroring `SmartListEngine.evaluate`'s own
 * "never re-scan per caller" rule.
 *
 * Deliberately includes done tasks — filtering which of a day's tasks to actually show
 * (e.g. only incomplete ones for a month-grid dot, done-and-struck-through in the day
 * agenda) is the caller's job, exactly like the Swift original. */
export function index(tasks: readonly ParsedTask[]): Map<string, ParsedTask[]> {
  const buckets = new Map<string, ParsedTask[]>();
  for (const task of tasks) {
    const anchor = anchorDate(task);
    if (anchor === null) continue;
    const key = calendarDateToISOString(anchor);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(task);
    else buckets.set(key, [task]);
  }
  return buckets;
}

/** Every incomplete task whose anchor date is strictly before `today` — anchor-based,
 * not due-only, so a scheduled-only task that has slipped is still caught even though
 * `due` was never set. */
export function overdue(tasks: readonly ParsedTask[], today: CalendarDate): ParsedTask[] {
  return tasks.filter((task) => {
    const anchor = anchorDate(task);
    if (anchor === null || compareCalendarDates(anchor, today) >= 0) return false;
    return task.status.kind !== "done";
  });
}
