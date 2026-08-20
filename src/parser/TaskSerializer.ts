import { calendarDateToISOString, type CalendarDate } from "../model/CalendarDate.js";
import { clockTimeToISOString, type ClockTime } from "../model/ClockTime.js";
import type { StringRange, TaskFieldKind } from "../model/FieldSpan.js";
import type { ParsedTask } from "../model/ParsedTask.js";
import { priorityMarker, type Priority } from "../model/Priority.js";
import { taskTagNormalizedKey, type TaskTag } from "../model/TaskTag.js";
import type { TaskLocation } from "../model/TaskLocation.js";
import type { TaskStatus } from "../model/TaskStatus.js";
import { DEFAULT_PARSER_CONFIGURATION, type ParserConfiguration } from "./ParserConfiguration.js";
import { MutationError } from "./ParserErrors.js";
import { parseLine } from "./TaskLineParser.js";

/**
 * Serialises a `ParsedTask` back to text, and applies field mutations.
 *
 * `serialize` on an untouched task always returns `raw` unchanged — byte-identical
 * round-trip by construction, not by effort (see `ParsedTask.ts`'s "spans, not
 * segments" framing). Every mutation splices only the text a field actually owns and
 * then re-parses the result, so the returned `ParsedTask` has fully consistent spans
 * without this module having to hand-maintain them across edits.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Parser/TaskSerializer.swift`.
 */

export function serialize(task: ParsedTask): string {
  return task.raw;
}

function spliceString(raw: string, range: StringRange, replacement: string): string {
  return raw.slice(0, range.start) + replacement + raw.slice(range.end);
}

function reparse(raw: string, location: TaskLocation | null, configuration: ParserConfiguration): ParsedTask {
  try {
    return parseLine(raw, { location, configuration });
  } catch {
    throw new MutationError(raw);
  }
}

/** A leading space to prefix a newly-inserted field with, unless the character
 * immediately before the insertion point is already whitespace (an empty body, or
 * another field's own trailing space already present). */
function insertionPrefix(task: ParsedTask): string {
  if (task.insertionPoint <= 0) return "";
  const prior = task.insertionPoint - 1;
  return task.raw[prior] === " " ? "" : " ";
}

// --- Status --------------------------------------------------------------------------

export function setStatus(
  task: ParsedTask,
  newStatus: TaskStatus,
  configuration: ParserConfiguration = DEFAULT_PARSER_CONFIGURATION,
): ParsedTask {
  const newRaw = spliceString(task.raw, task.statusCharRange, newStatus.symbol);
  return reparse(newRaw, task.location, configuration);
}

// --- Indentation -----------------------------------------------------------------------

/** Changes this task line's leading indentation, leaving marker/status/body untouched —
 * `indent` is always a literal prefix of `raw` by construction, so this is a plain
 * prefix swap, not a span lookup like every other field here. */
export function setIndent(
  task: ParsedTask,
  newIndent: string,
  configuration: ParserConfiguration = DEFAULT_PARSER_CONFIGURATION,
): ParsedTask {
  if (newIndent === task.indent) return task;
  const newRaw = newIndent + task.raw.slice(task.indent.length);
  return reparse(newRaw, task.location, configuration);
}

// --- Description -----------------------------------------------------------------------

const METADATA_KINDS = new Set<TaskFieldKind>([
  "due",
  "scheduled",
  "start",
  "created",
  "done",
  "cancelled",
  "reminder",
  "priority",
  "recurrence",
  "onCompletion",
  "id",
  "blockedBy",
  "globalFilterTag",
]);

/** Replaces the description text preceding the first metadata field. Tags and links
 * that appear before that point are part of the region being replaced; anything after
 * the first metadata field — including any tags placed after it — is left untouched. */
export function setDescription(
  task: ParsedTask,
  newDescription: string,
  configuration: ParserConfiguration = DEFAULT_PARSER_CONFIGURATION,
): ParsedTask {
  const starts = task.spans.filter((span) => METADATA_KINDS.has(span.kind)).map((span) => span.fullRange.start);
  const boundary = starts.length > 0 ? Math.min(...starts) : task.insertionPoint;
  const newRaw = spliceString(task.raw, { start: task.bodyStart, end: boundary }, newDescription);
  return reparse(newRaw, task.location, configuration);
}

// --- Dates -----------------------------------------------------------------------------

export type DateField = "due" | "scheduled" | "start" | "created" | "done";

const DATE_FIELD_DEFAULT_MARKER: Readonly<Record<DateField, string>> = {
  due: "📅",
  scheduled: "⏳",
  start: "🛫",
  created: "➕",
  done: "✅",
};

export function setDate(
  task: ParsedTask,
  field: DateField,
  newValue: CalendarDate | null,
  configuration: ParserConfiguration = DEFAULT_PARSER_CONFIGURATION,
): ParsedTask {
  // `DateField`'s string values are a literal subset of `TaskFieldKind`'s, so `field`
  // is already a valid `TaskFieldKind` — no separate "kind" mapping needed here, unlike
  // the Swift original's nominal `DateField` enum.
  return applyValueField(task, field, newValue === null ? null : calendarDateToISOString(newValue), DATE_FIELD_DEFAULT_MARKER[field], configuration);
}

// --- Reminder --------------------------------------------------------------------------

/** Sets, changes, or removes the `⏰` reminder field. `newValue === null` removes it
 * entirely; a `null` time writes a bare `⏰ YYYY-MM-DD` with no time. */
export function setReminder(
  task: ParsedTask,
  newValue: { date: CalendarDate; time: ClockTime | null } | null,
  configuration: ParserConfiguration = DEFAULT_PARSER_CONFIGURATION,
): ParsedTask {
  const newText =
    newValue === null
      ? null
      : newValue.time === null
        ? calendarDateToISOString(newValue.date)
        : `${calendarDateToISOString(newValue.date)} ${clockTimeToISOString(newValue.time)}`;
  return applyValueField(task, "reminder", newText, "⏰", configuration);
}

// --- Priority --------------------------------------------------------------------------

export function setPriority(
  task: ParsedTask,
  newPriority: Priority,
  configuration: ParserConfiguration = DEFAULT_PARSER_CONFIGURATION,
): ParsedTask {
  const existing = task.spans.find((span) => span.kind === "priority");
  const marker = priorityMarker(newPriority);
  if (existing !== undefined) {
    const newRaw = marker !== null ? spliceString(task.raw, existing.valueRange, marker) : spliceString(task.raw, existing.fullRange, "");
    return reparse(newRaw, task.location, configuration);
  }
  if (marker !== null) {
    const insertion = insertionPrefix(task) + marker;
    const newRaw = spliceString(task.raw, { start: task.insertionPoint, end: task.insertionPoint }, insertion);
    return reparse(newRaw, task.location, configuration);
  }
  return task;
}

// --- Recurrence ------------------------------------------------------------------------

/** Sets or removes the `🔁` recurrence rule text. Stored verbatim, not validated against
 * the recurrence grammar here (Wave 1 chunk 5) — matching every other mutation in this
 * module, a task's field text is just data; validation belongs to code that *acts* on
 * it, not to the code that writes it. */
export function setRecurrence(
  task: ParsedTask,
  newValue: string | null,
  configuration: ParserConfiguration = DEFAULT_PARSER_CONFIGURATION,
): ParsedTask {
  return applyValueField(task, "recurrence", newValue, "🔁", configuration);
}

// --- Tags ------------------------------------------------------------------------------

export function addTag(
  task: ParsedTask,
  tag: TaskTag,
  configuration: ParserConfiguration = DEFAULT_PARSER_CONFIGURATION,
): ParsedTask {
  // Swift checks `tag.raw.count > 1` (grapheme clusters); `.length` (UTF-16 code units)
  // agrees with it on every real tag shape — the only input where they could ever
  // diverge is a bare "#" with literally nothing after it, where both give the same
  // (rejecting) answer regardless of counting unit.
  if (!tag.raw.startsWith("#") || tag.raw.length <= 1) {
    throw new MutationError(tag.raw);
  }
  const key = taskTagNormalizedKey(tag);
  if (task.tags.some((existing) => taskTagNormalizedKey(existing) === key)) {
    return task;
  }
  const insertion = insertionPrefix(task) + tag.raw;
  const newRaw = spliceString(task.raw, { start: task.insertionPoint, end: task.insertionPoint }, insertion);
  return reparse(newRaw, task.location, configuration);
}

export function removeTag(
  task: ParsedTask,
  tag: TaskTag,
  configuration: ParserConfiguration = DEFAULT_PARSER_CONFIGURATION,
): ParsedTask {
  const key = taskTagNormalizedKey(tag);
  const existing = task.spans.find(
    (span) => span.kind === "tag" && task.raw.slice(span.valueRange.start, span.valueRange.end).toLowerCase() === key,
  );
  if (existing === undefined) return task;
  const newRaw = spliceString(task.raw, existing.fullRange, "");
  return reparse(newRaw, task.location, configuration);
}

// --- Shared field logic ------------------------------------------------------------------

/** Handles the replace/remove/insert cases for fields with a marker followed by a
 * separate value token. */
function applyValueField(
  task: ParsedTask,
  kind: TaskFieldKind,
  newText: string | null,
  defaultMarker: string,
  configuration: ParserConfiguration,
): ParsedTask {
  const existing = task.spans.find((span) => span.kind === kind);
  if (existing !== undefined) {
    const newRaw = newText !== null ? spliceString(task.raw, existing.valueRange, newText) : spliceString(task.raw, existing.fullRange, "");
    return reparse(newRaw, task.location, configuration);
  }
  if (newText !== null) {
    const insertion = insertionPrefix(task) + defaultMarker + " " + newText;
    const newRaw = spliceString(task.raw, { start: task.insertionPoint, end: task.insertionPoint }, insertion);
    return reparse(newRaw, task.location, configuration);
  }
  return task;
}
