import { calendarDateToISOString, parseCalendarDate, type CalendarDate } from "../model/CalendarDate.js";
import { PRIORITY_VALUES, type Priority } from "../model/Priority.js";
import type { TaskStatusKind } from "../model/TaskStatus.js";
import type { DateRangeFilter, FilterCriterion, FilterExpression, RelativeDateRange } from "./FilterCriterion.js";
import { GROUP_KEY_VALUES, type GroupKey } from "./GroupingEngine.js";
import { SMART_LIST_LENS_VALUES, type SmartList } from "./SmartList.js";
import { SORT_KEY_VALUES, type SortCriterion, type SortDirection } from "./SortCriterion.js";

/**
 * Hand-written encode/decode for the query model — `CalendarDate`, `DateRangeFilter`,
 * `FilterCriterion`, `FilterExpression`, `SmartList` — the shared wire format a
 * vault-stored user-defined smart list (§6.8) is persisted in, and the same format a
 * future Android/Kotlin implementation reads. This is the TS counterpart of
 * `PerliteCore/Sources/PerliteCore/Query/QueryCoding.swift`.
 *
 * A `"type"` string discriminator per case, mirroring Swift's own hand-written
 * `Codable` exactly — see that file's doc comment for why (not Swift's synthesised
 * enum-with-associated-values shape, which isn't a documented, stable format). Decoding
 * an unrecognised `"type"`, or a value of the wrong shape, always throws
 * `QueryCodingError` rather than silently dropping data — a smart list that quietly
 * loses a clause on decode shows the user the wrong tasks.
 *
 * One deliberate divergence from the Swift original's own test suite: that suite pins
 * an exact sorted-key JSON *string* as a golden test, since Swift's encoder can be told
 * to sort keys. `JSON.stringify` has no equivalent option, and sorting keys ourselves
 * before encoding would be extra machinery with no correctness benefit — any conformant
 * JSON parser reads an object's keys regardless of their order, so the wire format's
 * cross-language compatibility does not depend on key order at all. This file's own
 * golden test instead pins the exact **parsed** shape (`JSON.parse` deep-equality),
 * which catches the same class of drift (a renamed field, a changed discriminator
 * value) without depending on an ordering property that was never actually load-bearing.
 */

export class QueryCodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryCodingError";
  }
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new QueryCodingError(`Expected an object for ${context}, got ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, context: string): string {
  if (typeof value !== "string") throw new QueryCodingError(`Expected a string for ${context}, got ${JSON.stringify(value)}`);
  return value;
}

function expectBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") throw new QueryCodingError(`Expected a boolean for ${context}, got ${JSON.stringify(value)}`);
  return value;
}

function expectOneOf<T extends string>(value: unknown, allowed: readonly T[], context: string): T {
  const str = expectString(value, context);
  if (!(allowed as readonly string[]).includes(str)) {
    throw new QueryCodingError(`Not a valid ${context}: ${str}`);
  }
  return str as T;
}

function decodeArray<T>(value: unknown, context: string, decodeOne: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new QueryCodingError(`Expected an array for ${context}, got ${JSON.stringify(value)}`);
  return value.map(decodeOne);
}

// --- CalendarDate ------------------------------------------------------------------------

/** Encodes as the canonical `YYYY-MM-DD` string, not three integer fields — one
 * obviously-correct representation, not two. */
export function encodeCalendarDate(date: CalendarDate): string {
  return calendarDateToISOString(date);
}

/** Throws on a malformed string rather than falling back to some default date — a smart
 * list is user data; guessing at a corrupt date is worse than surfacing the failure via
 * the store's own decode-failure handling. Matches the Swift original in checking only
 * syntactic `YYYY-MM-DD` shape, not calendar validity (`isValidGregorianDate`) — a
 * syntactically-well-formed but out-of-range date like `"2026-02-30"` decodes
 * successfully here, same as it does there. */
export function decodeCalendarDate(value: unknown): CalendarDate {
  const raw = expectString(value, "CalendarDate");
  const parsed = parseCalendarDate(raw);
  if (parsed === null) throw new QueryCodingError(`Not a YYYY-MM-DD date: ${raw}`);
  return parsed;
}

// --- DateRangeFilter ---------------------------------------------------------------------

const RELATIVE_DATE_RANGE_VALUES: readonly RelativeDateRange[] = ["overdue", "today", "next7Days", "last7Days"];

export function encodeDateRangeFilter(range: DateRangeFilter): unknown {
  switch (range.type) {
    case "none":
      return { type: "none" };
    case "before":
      return { type: "before", date: encodeCalendarDate(range.date) };
    case "onOrAfter":
      return { type: "onOrAfter", date: encodeCalendarDate(range.date) };
    case "between":
      return { type: "between", start: encodeCalendarDate(range.start), end: encodeCalendarDate(range.end) };
    case "relative":
      return { type: "relative", value: range.value };
  }
}

export function decodeDateRangeFilter(value: unknown): DateRangeFilter {
  const obj = asRecord(value, "DateRangeFilter");
  const type = expectString(obj.type, "DateRangeFilter.type");
  switch (type) {
    case "none":
      return { type: "none" };
    case "before":
      return { type: "before", date: decodeCalendarDate(obj.date) };
    case "onOrAfter":
      return { type: "onOrAfter", date: decodeCalendarDate(obj.date) };
    case "between":
      return { type: "between", start: decodeCalendarDate(obj.start), end: decodeCalendarDate(obj.end) };
    case "relative":
      return { type: "relative", value: expectOneOf(obj.value, RELATIVE_DATE_RANGE_VALUES, "RelativeDateRange") };
    default:
      throw new QueryCodingError(`Not a DateRangeFilter type: ${type}`);
  }
}

// --- FilterCriterion -----------------------------------------------------------------------

const TASK_STATUS_KIND_VALUES: readonly TaskStatusKind[] = ["todo", "done", "cancelled", "custom"];

export function encodeFilterCriterion(criterion: FilterCriterion): unknown {
  switch (criterion.type) {
    case "status":
      return { type: "status", kind: criterion.kind };
    case "priority":
      return { type: "priority", value: criterion.value };
    case "dueDate":
      return { type: "dueDate", range: encodeDateRangeFilter(criterion.range) };
    case "scheduledDate":
      return { type: "scheduledDate", range: encodeDateRangeFilter(criterion.range) };
    case "startDate":
      return { type: "startDate", range: encodeDateRangeFilter(criterion.range) };
    case "doneDate":
      return { type: "doneDate", range: encodeDateRangeFilter(criterion.range) };
    case "tagExact":
      return { type: "tagExact", tag: criterion.tag };
    case "tagContains":
      return { type: "tagContains", text: criterion.text };
    case "pathContains":
      return { type: "pathContains", text: criterion.text };
    case "textContains":
      return { type: "textContains", text: criterion.text };
    case "hasDescription":
      return { type: "hasDescription", value: criterion.value };
  }
}

export function decodeFilterCriterion(value: unknown): FilterCriterion {
  const obj = asRecord(value, "FilterCriterion");
  const type = expectString(obj.type, "FilterCriterion.type");
  switch (type) {
    case "status":
      return { type: "status", kind: expectOneOf(obj.kind, TASK_STATUS_KIND_VALUES, "TaskStatusKind") };
    case "priority":
      return { type: "priority", value: expectOneOf(obj.value, PRIORITY_VALUES, "Priority") };
    case "dueDate":
      return { type: "dueDate", range: decodeDateRangeFilter(obj.range) };
    case "scheduledDate":
      return { type: "scheduledDate", range: decodeDateRangeFilter(obj.range) };
    case "startDate":
      return { type: "startDate", range: decodeDateRangeFilter(obj.range) };
    case "doneDate":
      return { type: "doneDate", range: decodeDateRangeFilter(obj.range) };
    case "tagExact":
      return { type: "tagExact", tag: expectString(obj.tag, "FilterCriterion.tag") };
    case "tagContains":
      return { type: "tagContains", text: expectString(obj.text, "FilterCriterion.text") };
    case "pathContains":
      return { type: "pathContains", text: expectString(obj.text, "FilterCriterion.text") };
    case "textContains":
      return { type: "textContains", text: expectString(obj.text, "FilterCriterion.text") };
    case "hasDescription":
      return { type: "hasDescription", value: expectBoolean(obj.value, "FilterCriterion.value") };
    default:
      throw new QueryCodingError(`Not a FilterCriterion type: ${type}`);
  }
}

// --- FilterExpression ----------------------------------------------------------------------

export function encodeFilterExpression(expression: FilterExpression): unknown {
  switch (expression.type) {
    case "criterion":
      return { type: "criterion", criterion: encodeFilterCriterion(expression.criterion) };
    case "and":
      return { type: "and", expressions: expression.expressions.map(encodeFilterExpression) };
    case "or":
      return { type: "or", expressions: expression.expressions.map(encodeFilterExpression) };
    case "not":
      return { type: "not", expression: encodeFilterExpression(expression.expression) };
  }
}

export function decodeFilterExpression(value: unknown): FilterExpression {
  const obj = asRecord(value, "FilterExpression");
  const type = expectString(obj.type, "FilterExpression.type");
  switch (type) {
    case "criterion":
      return { type: "criterion", criterion: decodeFilterCriterion(obj.criterion) };
    case "and":
      return { type: "and", expressions: decodeArray(obj.expressions, "FilterExpression.expressions", decodeFilterExpression) };
    case "or":
      return { type: "or", expressions: decodeArray(obj.expressions, "FilterExpression.expressions", decodeFilterExpression) };
    case "not":
      return { type: "not", expression: decodeFilterExpression(obj.expression) };
    default:
      throw new QueryCodingError(`Not a FilterExpression type: ${type}`);
  }
}

// --- SortCriterion / GroupKey ----------------------------------------------------------

const SORT_DIRECTION_VALUES: readonly SortDirection[] = ["ascending", "descending"];

export function encodeSortCriterion(criterion: SortCriterion): unknown {
  return { key: criterion.key, direction: criterion.direction };
}

export function decodeSortCriterion(value: unknown): SortCriterion {
  const obj = asRecord(value, "SortCriterion");
  return {
    key: expectOneOf(obj.key, SORT_KEY_VALUES, "SortKey"),
    direction: expectOneOf(obj.direction, SORT_DIRECTION_VALUES, "SortDirection"),
  };
}

function decodeGroupKey(value: unknown): GroupKey {
  return expectOneOf(value, GROUP_KEY_VALUES, "GroupKey");
}

// --- SmartList -----------------------------------------------------------------------------

export function encodeSmartList(list: SmartList): unknown {
  return {
    id: list.id,
    name: list.name,
    icon: list.icon,
    accentToken: list.accentToken,
    filter: encodeFilterExpression(list.filter),
    grouping: list.grouping,
    sorting: list.sorting.map(encodeSortCriterion),
    isBuiltIn: list.isBuiltIn,
    lens: list.lens,
  };
}

export function decodeSmartList(value: unknown): SmartList {
  const obj = asRecord(value, "SmartList");
  const grouping = obj.grouping === null || obj.grouping === undefined ? null : decodeGroupKey(obj.grouping);
  // Wave 3 addition: a `smart-lists.json` written before this change has no `lens` key
  // at all — default it to `"list"` rather than throwing, so an already-saved file keeps
  // decoding correctly with no schema-version bump or migration step, the same
  // backward-compatible-default trick `grouping`'s own `null`/`undefined` handling above
  // already relies on.
  const lens = obj.lens === undefined ? "list" : expectOneOf(obj.lens, SMART_LIST_LENS_VALUES, "SmartListLens");
  return {
    id: expectString(obj.id, "SmartList.id"),
    name: expectString(obj.name, "SmartList.name"),
    icon: expectString(obj.icon, "SmartList.icon"),
    accentToken: expectString(obj.accentToken, "SmartList.accentToken"),
    filter: decodeFilterExpression(obj.filter),
    grouping,
    sorting: decodeArray(obj.sorting, "SmartList.sorting", decodeSortCriterion),
    isBuiltIn: expectBoolean(obj.isBuiltIn, "SmartList.isBuiltIn"),
    lens,
  };
}
