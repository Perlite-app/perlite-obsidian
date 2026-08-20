import { compareCalendarDates, type CalendarDate } from "../model/CalendarDate.js";
import { dateValueCalendarDate } from "../model/DateValue.js";
import type { ParsedTask } from "../model/ParsedTask.js";

/**
 * The default list lens's four sections (§6.5): "Default view is segmented: Overdue /
 * Today / Upcoming / No date. A single flat dump of every incomplete task in the vault
 * is not a usable daily driver."
 *
 * 1:1 behavioural port of `PerliteCore/Sources/PerliteCore/Query/DefaultListView.swift`
 * — same four segments, same partitioning bug fixes already shipped there (native
 * chunks 19/29/30), but written as plain predicate functions instead of going through a
 * `FilterCriterion`/`FilterExpression` tree: that generic query engine is Wave 2 chunk
 * 10's job (`query/FilterEngine.ts` doesn't exist yet), and hand-rolling one now for
 * four fixed segments would be exactly the kind of premature abstraction this codebase
 * otherwise avoids. When chunk 10 lands, this file is a natural candidate to be
 * rebuilt on top of it — not before, since there's nothing here yet to reuse.
 */
export type DefaultSegmentKind = "overdue" | "today" | "upcoming" | "noDate";

/** `CaseIterable`'s declaration order in the Swift original is display order. */
export const DEFAULT_SEGMENTS: readonly DefaultSegmentKind[] = ["overdue", "today", "upcoming", "noDate"];

export const DEFAULT_SEGMENT_TITLE: Readonly<Record<DefaultSegmentKind, string>> = {
  overdue: "Overdue",
  today: "Today",
  upcoming: "Upcoming",
  noDate: "No Date",
};

function isOverdue(date: CalendarDate | null, today: CalendarDate): boolean {
  return date !== null && compareCalendarDates(date, today) < 0;
}

function isDueToday(date: CalendarDate | null, today: CalendarDate): boolean {
  return date !== null && compareCalendarDates(date, today) === 0;
}

/** "Due or scheduled is overdue-or-today, on either field" — `today`'s own matching
 * rule, factored out so `upcoming` can exclude exactly what `today` claims (see that
 * case's comment below) instead of the two segments drifting out of sync. */
function dueOrScheduledOverdueOrToday(task: ParsedTask, today: CalendarDate): boolean {
  const due = dateValueCalendarDate(task.due);
  const scheduled = dateValueCalendarDate(task.scheduled);
  return isOverdue(due, today) || isDueToday(due, today) || isOverdue(scheduled, today) || isDueToday(scheduled, today);
}

/** Whether `task` belongs in `segment` on `today`. All four segments uniformly exclude
 * done tasks — this view's framing is "every *incomplete* task, segmented," unlike
 * §6.8's `Upcoming` smart list (a different feature, no "not done" qualifier by
 * design), so a completed task must never resurface here. */
export function matchesDefaultSegment(task: ParsedTask, segment: DefaultSegmentKind, today: CalendarDate): boolean {
  if (task.status.kind === "done") return false;

  const due = dateValueCalendarDate(task.due);
  const scheduled = dateValueCalendarDate(task.scheduled);
  const start = dateValueCalendarDate(task.start);

  switch (segment) {
    case "overdue":
      // Deliberately checks `due` only, never `scheduled` — a task overdue only on
      // `scheduled` still surfaces in Today (see that case below), not here.
      return isOverdue(due, today);

    case "today":
      // Excludes exactly what `overdue` claims (due-overdue), so the two segments
      // partition rather than both matching every due-overdue task unconditionally —
      // native chunk 29's fix for the reported "same task shows up both in Overdue and
      // in Today" bug. A task overdue only on `scheduled` isn't excluded here, since
      // `overdue` was never claiming it in the first place.
      if (isOverdue(due, today)) return false;
      return dueOrScheduledOverdueOrToday(task, today);

    case "upcoming": {
      // Uncapped remainder bucket for any dated, not-yet-claimed task — native chunk
      // 30's fix for a task due 12+ days out silently belonging to no segment at all
      // (excluded from No Date by having a date, excluded from a since-removed 7-day
      // cap by being too far out).
      const hasDate = due !== null || scheduled !== null;
      if (!hasDate) return false;
      return !dueOrScheduledOverdueOrToday(task, today);
    }

    case "noDate":
      return due === null && scheduled === null && start === null;
  }
}
