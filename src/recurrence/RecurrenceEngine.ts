import { dateValueCalendarDate } from "../model/DateValue.js";
import type { ParsedTask } from "../model/ParsedTask.js";
import type { CalendarDate } from "../model/CalendarDate.js";
import { TASK_STATUS_DONE, TASK_STATUS_TODO } from "../model/TaskStatus.js";
import { DEFAULT_PARSER_CONFIGURATION, type ParserConfiguration } from "../parser/ParserConfiguration.js";
import * as TaskSerializer from "../parser/TaskSerializer.js";
import type { DateField } from "../parser/TaskSerializer.js";
import { addDays, daysBetween, nextOccurrenceOfRule } from "./RecurrenceCalculator.js";
import { parseRecurrenceRule } from "./RecurrenceParser.js";

/**
 * Completes a task, regenerating the next instance when it recurs. This is the single
 * entry point a future "tap the status control" handler needs — it handles non-recurring
 * and recurring tasks uniformly, so callers never have to branch on whether a task has a
 * `🔁` marker before deciding how to complete it.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Recurrence/RecurrenceEngine.swift`.
 */

export interface CompletionResult {
  /** The original line, now marked done — always present. */
  readonly completedLine: string;
  /** The next occurrence, as a new line to insert — `null` when the task doesn't
   * recur. */
  readonly nextInstanceLine: string | null;
}

export type CompletionErrorCode = "unparseableRecurrenceRule" | "cannotComputeNextInstance";

export class CompletionError extends Error {
  readonly code: CompletionErrorCode;
  /** The unparseable rule text, when `code === "unparseableRecurrenceRule"`. */
  readonly ruleText: string | null;

  constructor(code: CompletionErrorCode, ruleText: string | null = null) {
    super(code === "unparseableRecurrenceRule" ? `unparseableRecurrenceRule: ${ruleText ?? ""}` : code);
    this.name = "CompletionError";
    this.code = code;
    this.ruleText = ruleText;
  }
}

function markDone(task: ParsedTask, today: CalendarDate, configuration: ParserConfiguration): ParsedTask {
  const statused = TaskSerializer.setStatus(task, TASK_STATUS_DONE, configuration);
  return TaskSerializer.setDate(statused, "done", today, configuration);
}

/** Builds the next occurrence from the *original* (pre-completion) task by applying
 * `TaskSerializer` mutations — reusing the splice-then-reparse machinery rather than a
 * parallel "build a line from a field set" path. Everything not explicitly touched here
 * (description, tags, priority, links, id, blockedBy, the recurrence text itself)
 * carries forward unmodified because those mutation calls are simply never made. */
function buildNextInstance(
  task: ParsedTask,
  deltaDays: number,
  fallbackDue: CalendarDate,
  today: CalendarDate,
  configuration: ParserConfiguration,
): ParsedTask {
  let next = TaskSerializer.setStatus(task, TASK_STATUS_TODO, configuration);

  // A freshly generated occurrence must never be pre-completed, regardless of what
  // `task` (the thing just marked done) carried — nothing upstream actually guarantees
  // `task` was `.todo` to begin with (`complete` has no precondition on `task.status`),
  // and a stale done-date silently surviving into a fresh instance is exactly the kind
  // of corrupted-looking line that's worse than an outright failure. Cleared
  // unconditionally, not only when `task.done` happens to already be set.
  next = TaskSerializer.setDate(next, "done", null, configuration);

  const dateFieldPairs: readonly [ParsedTask["due"], DateField][] = [
    [task.due, "due"],
    [task.scheduled, "scheduled"],
    [task.start, "start"],
  ];
  let shiftedAnyDateField = false;
  for (const [originalValue, targetField] of dateFieldPairs) {
    const original = dateValueCalendarDate(originalValue);
    if (original === null) continue;
    const shifted = addDays(deltaDays, original);
    if (shifted === null) continue;
    next = TaskSerializer.setDate(next, targetField, shifted, configuration);
    shiftedAnyDateField = true;
  }
  // Recurrence has to anchor its date somewhere; a task with no due/scheduled/start at
  // all falls back to inventing a due date from the computed next occurrence.
  if (!shiftedAnyDateField) {
    next = TaskSerializer.setDate(next, "due", fallbackDue, configuration);
  }

  // A fresh instance's creation date is "now", not the old created date shifted — it
  // genuinely is being created today, not moved.
  if (task.created !== null) {
    next = TaskSerializer.setDate(next, "created", today, configuration);
  }

  return next;
}

export function complete(task: ParsedTask, today: CalendarDate, configuration: ParserConfiguration = DEFAULT_PARSER_CONFIGURATION): CompletionResult {
  if (task.recurrenceRule === null) {
    const completed = markDone(task, today, configuration);
    return { completedLine: TaskSerializer.serialize(completed), nextInstanceLine: null };
  }

  // Resolve the rule and the next date *before* mutating anything — a refusal must
  // leave the original task completely untouched.
  const rule = parseRecurrenceRule(task.recurrenceRule);
  if (rule === null) {
    throw new CompletionError("unparseableRecurrenceRule", task.recurrenceRule);
  }

  const referenceDate = rule.whenDone
    ? today
    : (dateValueCalendarDate(task.due) ?? dateValueCalendarDate(task.scheduled) ?? dateValueCalendarDate(task.start) ?? today);

  const nextDate = nextOccurrenceOfRule(rule, referenceDate);
  const deltaDays = nextDate === null ? null : daysBetween(referenceDate, nextDate);
  if (nextDate === null || deltaDays === null) {
    throw new CompletionError("cannotComputeNextInstance");
  }

  const completed = markDone(task, today, configuration);
  const nextInstance = buildNextInstance(task, deltaDays, nextDate, today, configuration);

  return {
    completedLine: TaskSerializer.serialize(completed),
    nextInstanceLine: TaskSerializer.serialize(nextInstance),
  };
}
