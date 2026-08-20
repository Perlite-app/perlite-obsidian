import { compareCalendarDates, type CalendarDate } from "../model/CalendarDate.js";
import { dateValueCalendarDate } from "../model/DateValue.js";
import { allTags, type ParsedTask } from "../model/ParsedTask.js";
import { addDays } from "../recurrence/RecurrenceCalculator.js";
import type { DateRangeFilter, FilterCriterion, FilterExpression, RelativeDateRange } from "./FilterCriterion.js";

/**
 * Evaluates `FilterExpression`s against `ParsedTask`s. Stateless and single-pass —
 * `apply` is a plain `Array.filter` over the given tasks, which is what §6.8's
 * smart-list performance requirement ("all smart list contents and badge counts derive
 * from a single in-memory pass... never re-read or re-parse the vault per list") builds
 * on.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Query/FilterEngine.swift`. Case-
 * insensitive substring/tag matches use `.toLowerCase()` — the same documented
 * cross-language case-folding caveat `TaskTag.ts`'s `normalizedKey` already carries,
 * not a new one.
 */

export function apply(tasks: readonly ParsedTask[], expression: FilterExpression, today: CalendarDate): ParsedTask[] {
  return tasks.filter((task) => matches(task, expression, today));
}

/** MVP §6.7's "global text search across all task titles and descriptions" — a named
 * entry point over `textContains`, not a separate search implementation. An empty
 * `query` matches nothing, since an unfiltered "show everything" belongs to the
 * caller's own logic, not to a search function. */
export function search(tasks: readonly ParsedTask[], query: string): ParsedTask[] {
  if (query.length === 0) return [];
  const needle = query.toLowerCase();
  return tasks.filter((task) => task.description.toLowerCase().includes(needle));
}

export function matches(task: ParsedTask, expression: FilterExpression, today: CalendarDate): boolean {
  switch (expression.type) {
    case "criterion":
      return matchesCriterion(task, expression.criterion, today);
    case "and":
      return expression.expressions.every((inner) => matches(task, inner, today));
    case "or":
      return expression.expressions.some((inner) => matches(task, inner, today));
    case "not":
      return !matches(task, expression.expression, today);
  }
}

function matchesCriterion(task: ParsedTask, criterion: FilterCriterion, today: CalendarDate): boolean {
  switch (criterion.type) {
    case "status":
      return task.status.kind === criterion.kind;
    case "priority":
      return task.priority === criterion.value;
    case "dueDate":
      return matchesDate(dateValueCalendarDate(task.due), criterion.range, today);
    case "scheduledDate":
      return matchesDate(dateValueCalendarDate(task.scheduled), criterion.range, today);
    case "startDate":
      return matchesDate(dateValueCalendarDate(task.start), criterion.range, today);
    case "doneDate":
      return matchesDate(dateValueCalendarDate(task.done), criterion.range, today);
    case "tagExact": {
      const key = criterion.tag.toLowerCase();
      return allTags(task).some((tag) => tag.raw.toLowerCase() === key);
    }
    case "tagContains": {
      const needle = criterion.text.toLowerCase();
      return allTags(task).some((tag) => tag.raw.toLowerCase().includes(needle));
    }
    case "pathContains": {
      const path = task.location?.filePath;
      if (path === null || path === undefined) return false;
      return path.toLowerCase().includes(criterion.text.toLowerCase());
    }
    case "textContains":
      return task.description.toLowerCase().includes(criterion.text.toLowerCase());
    case "hasDescription": {
      const hasText = task.description.trim().length > 0;
      return hasText === criterion.value;
    }
  }
}

function matchesDate(date: CalendarDate | null, range: DateRangeFilter, today: CalendarDate): boolean {
  switch (range.type) {
    case "none":
      return date === null;
    case "before":
      return date !== null && compareCalendarDates(date, range.date) < 0;
    case "onOrAfter":
      return date !== null && compareCalendarDates(date, range.date) >= 0;
    case "between":
      return date !== null && compareCalendarDates(date, range.start) >= 0 && compareCalendarDates(date, range.end) <= 0;
    case "relative":
      return matchesRelative(date, range.value, today);
  }
}

function matchesRelative(date: CalendarDate | null, value: RelativeDateRange, today: CalendarDate): boolean {
  if (date === null) return false;
  switch (value) {
    case "overdue":
      return compareCalendarDates(date, today) < 0;
    case "today":
      return compareCalendarDates(date, today) === 0;
    case "next7Days": {
      const end = addDays(7, today);
      return end !== null && compareCalendarDates(date, today) >= 0 && compareCalendarDates(date, end) <= 0;
    }
    case "last7Days": {
      const start = addDays(-7, today);
      return start !== null && compareCalendarDates(date, start) >= 0 && compareCalendarDates(date, today) <= 0;
    }
  }
}
