import { compareCalendarDates, type CalendarDate } from "../model/CalendarDate.js";
import { dateValueCalendarDate } from "../model/DateValue.js";
import type { ParsedTask } from "../model/ParsedTask.js";
import type { Priority } from "../model/Priority.js";
import type { TaskStatusKind } from "../model/TaskStatus.js";
import type { SortCriterion, SortDirection } from "./SortCriterion.js";

/**
 * Applies an ordered list of `SortCriterion`s to a task list — each level only breaks
 * ties left by the previous one, which is what "priority then due date" (§6.7's own
 * example) means in practice. `Array.prototype.sort` is stable per the ES2019 spec (and
 * has been in every JS engine Obsidian ships on since well before then), so tasks equal
 * under every given criterion keep their original relative order rather than shuffling
 * unpredictably between refreshes — the same guarantee the Swift original leans on.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Query/SortEngine.swift`.
 */
export function sort(tasks: readonly ParsedTask[], criteria: readonly SortCriterion[]): ParsedTask[] {
  return [...tasks].sort((a, b) => {
    for (const criterion of criteria) {
      const orderedBefore = isOrderedBefore(a, b, criterion);
      if (orderedBefore !== null) return orderedBefore ? -1 : 1;
    }
    return 0;
  });
}

/** `null` means "equal under this criterion" — the caller moves on to the next one. */
function isOrderedBefore(a: ParsedTask, b: ParsedTask, criterion: SortCriterion): boolean | null {
  switch (criterion.key) {
    case "dueDate":
      return compareDates(dateValueCalendarDate(a.due), dateValueCalendarDate(b.due), criterion.direction);
    case "scheduledDate":
      return compareDates(dateValueCalendarDate(a.scheduled), dateValueCalendarDate(b.scheduled), criterion.direction);
    case "startDate":
      return compareDates(dateValueCalendarDate(a.start), dateValueCalendarDate(b.start), criterion.direction);
    case "priority":
      return compareRanks(priorityRank(a.priority), priorityRank(b.priority), criterion.direction);
    case "status":
      return compareRanks(statusRank(a.status.kind), statusRank(b.status.kind), criterion.direction);
    case "description": {
      const aLower = a.description.toLowerCase();
      const bLower = b.description.toLowerCase();
      if (aLower === bLower) return null;
      const ascending = aLower < bLower;
      return criterion.direction === "ascending" ? ascending : !ascending;
    }
  }
}

/** A task with no date for this field always sorts after one that has it, regardless of
 * direction — direction only decides the order *among* tasks that both have a date,
 * mirroring the "unknown bucket always last" rule `GroupingEngine` uses. */
function compareDates(a: CalendarDate | null, b: CalendarDate | null, direction: SortDirection): boolean | null {
  if (a === null && b === null) return null;
  if (a === null) return false;
  if (b === null) return true;
  const comparison = compareCalendarDates(a, b);
  if (comparison === 0) return null;
  const ascending = comparison < 0;
  return direction === "ascending" ? ascending : !ascending;
}

function compareRanks(a: number, b: number, direction: SortDirection): boolean | null {
  if (a === b) return null;
  const ascending = a < b;
  return direction === "ascending" ? ascending : !ascending;
}

/** Ascending = highest priority first (rank 0), matching how "sorted by priority" reads
 * by default in this class of app; descending reverses it. */
const PRIORITY_RANK: Readonly<Record<Priority, number>> = {
  highest: 0,
  high: 1,
  medium: 2,
  normal: 3,
  low: 4,
  lowest: 5,
};

function priorityRank(priority: Priority): number {
  return PRIORITY_RANK[priority];
}

/** Ascending = active states first, terminal states last — the same order
 * `GroupingEngine.group(by: "status")` uses, for consistency. */
const STATUS_RANK: Readonly<Record<TaskStatusKind, number>> = {
  todo: 0,
  custom: 1,
  done: 2,
  cancelled: 3,
};

function statusRank(kind: TaskStatusKind): number {
  return STATUS_RANK[kind];
}
