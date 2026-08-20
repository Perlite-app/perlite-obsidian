import type { CalendarDate } from "../model/CalendarDate.js";
import type { Priority } from "../model/Priority.js";
import type { TaskStatusKind } from "../model/TaskStatus.js";
import { todayCalendarDate } from "../support/today.js";
import type { DateRangeFilter, FilterCriterion, FilterExpression, RelativeDateRange } from "./FilterCriterion.js";

/**
 * The flat filterable dimension a `FilterCriterion` targets, and a flat, editable
 * mirror of one `FilterCriterion` (optionally negated) — what one row of the smart-list
 * filter builder edits. Gives every row a stable identity independent of its current
 * value, unlike keying off the criterion itself.
 *
 * 1:1 port of `CriterionDraft.swift`. Every operand for every `field` is stored, not
 * just the currently-selected one's — switching `field` in the picker never discards
 * whatever the user already entered for a previously-selected field, in case they
 * switch back. Uses `CalendarDate` directly (no `Date` intermediate) since TS has no
 * SwiftUI `DatePicker` binding requirement to satisfy.
 */

export type CriterionField =
  | "status"
  | "priority"
  | "dueDate"
  | "scheduledDate"
  | "startDate"
  | "doneDate"
  | "tagExact"
  | "tagContains"
  | "pathContains"
  | "textContains"
  | "hasDescription";

export const CRITERION_FIELDS: readonly CriterionField[] = [
  "status",
  "priority",
  "dueDate",
  "scheduledDate",
  "startDate",
  "doneDate",
  "tagExact",
  "tagContains",
  "pathContains",
  "textContains",
  "hasDescription",
];

export const CRITERION_FIELD_LABEL: Readonly<Record<CriterionField, string>> = {
  status: "Status",
  priority: "Priority",
  dueDate: "Due date",
  scheduledDate: "Scheduled date",
  startDate: "Start date",
  doneDate: "Done date",
  tagExact: "Tag is",
  tagContains: "Tag contains",
  pathContains: "Path contains",
  textContains: "Text contains",
  hasDescription: "Has description",
};

/** `DateRangeFilter`'s cases, flattened to something a picker can select over. */
export type DateRangeKind = "none" | "before" | "onOrAfter" | "between" | "relative";

export const DATE_RANGE_KINDS: readonly DateRangeKind[] = ["none", "before", "onOrAfter", "between", "relative"];

export const DATE_RANGE_KIND_LABEL: Readonly<Record<DateRangeKind, string>> = {
  none: "No date set",
  before: "Before",
  onOrAfter: "On or after",
  between: "Between",
  relative: "Relative",
};

export const RELATIVE_DATE_RANGES: readonly RelativeDateRange[] = ["overdue", "today", "next7Days", "last7Days"];

export const RELATIVE_DATE_RANGE_LABEL: Readonly<Record<RelativeDateRange, string>> = {
  overdue: "Overdue",
  today: "Today",
  next7Days: "Next 7 days",
  last7Days: "Last 7 days",
};

export interface CriterionDraft {
  readonly id: string;
  field: CriterionField;
  isNegated: boolean;
  statusKind: TaskStatusKind;
  priority: Priority;
  dateRangeKind: DateRangeKind;
  relativeRange: RelativeDateRange;
  date: CalendarDate;
  rangeStart: CalendarDate;
  rangeEnd: CalendarDate;
  text: string;
  boolValue: boolean;
}

function makeID(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function createCriterionDraft(field: CriterionField = "tagExact", isNegated = false): CriterionDraft {
  const today = todayCalendarDate();
  return {
    id: makeID(),
    field,
    isNegated,
    statusKind: "todo",
    priority: "high",
    dateRangeKind: "relative",
    relativeRange: "today",
    date: today,
    rangeStart: today,
    rangeEnd: today,
    text: "",
    boolValue: true,
  };
}

function applyDateRange(draft: CriterionDraft, range: DateRangeFilter): void {
  switch (range.type) {
    case "none":
      draft.dateRangeKind = "none";
      return;
    case "before":
      draft.dateRangeKind = "before";
      draft.date = range.date;
      return;
    case "onOrAfter":
      draft.dateRangeKind = "onOrAfter";
      draft.date = range.date;
      return;
    case "between":
      draft.dateRangeKind = "between";
      draft.rangeStart = range.start;
      draft.rangeEnd = range.end;
      return;
    case "relative":
      draft.dateRangeKind = "relative";
      draft.relativeRange = range.value;
      return;
  }
}

/** Reconstructs a draft from an existing criterion — used both when opening the editor
 * on a list that already has a filter, and by `flatFilterFromExpression`'s detection of
 * whether a stored expression fits the flat editor at all. */
export function criterionDraftFromCriterion(criterion: FilterCriterion, isNegated = false): CriterionDraft {
  const draft = createCriterionDraft(criterion.type === "status" ? "status" : "tagExact", isNegated);
  switch (criterion.type) {
    case "status":
      draft.field = "status";
      draft.statusKind = criterion.kind;
      break;
    case "priority":
      draft.field = "priority";
      draft.priority = criterion.value;
      break;
    case "dueDate":
      draft.field = "dueDate";
      applyDateRange(draft, criterion.range);
      break;
    case "scheduledDate":
      draft.field = "scheduledDate";
      applyDateRange(draft, criterion.range);
      break;
    case "startDate":
      draft.field = "startDate";
      applyDateRange(draft, criterion.range);
      break;
    case "doneDate":
      draft.field = "doneDate";
      applyDateRange(draft, criterion.range);
      break;
    case "tagExact":
      draft.field = "tagExact";
      draft.text = criterion.tag;
      break;
    case "tagContains":
      draft.field = "tagContains";
      draft.text = criterion.text;
      break;
    case "pathContains":
      draft.field = "pathContains";
      draft.text = criterion.text;
      break;
    case "textContains":
      draft.field = "textContains";
      draft.text = criterion.text;
      break;
    case "hasDescription":
      draft.field = "hasDescription";
      draft.boolValue = criterion.value;
      break;
  }
  return draft;
}

function draftDateRange(draft: CriterionDraft): DateRangeFilter {
  switch (draft.dateRangeKind) {
    case "none":
      return { type: "none" };
    case "before":
      return { type: "before", date: draft.date };
    case "onOrAfter":
      return { type: "onOrAfter", date: draft.date };
    case "between":
      return { type: "between", start: draft.rangeStart, end: draft.rangeEnd };
    case "relative":
      return { type: "relative", value: draft.relativeRange };
  }
}

/** A missing leading `#` is corrected the same way the native app's tag-add flow does —
 * a tag criterion should behave identically whether the user typed `work` or `#work`. */
function normalizedTagText(text: string): string {
  return text.startsWith("#") ? text : `#${text}`;
}

export function criterionDraftToCriterion(draft: CriterionDraft): FilterCriterion {
  switch (draft.field) {
    case "status":
      return { type: "status", kind: draft.statusKind };
    case "priority":
      return { type: "priority", value: draft.priority };
    case "dueDate":
      return { type: "dueDate", range: draftDateRange(draft) };
    case "scheduledDate":
      return { type: "scheduledDate", range: draftDateRange(draft) };
    case "startDate":
      return { type: "startDate", range: draftDateRange(draft) };
    case "doneDate":
      return { type: "doneDate", range: draftDateRange(draft) };
    case "tagExact":
      return { type: "tagExact", tag: normalizedTagText(draft.text) };
    case "tagContains":
      return { type: "tagContains", text: draft.text };
    case "pathContains":
      return { type: "pathContains", text: draft.text };
    case "textContains":
      return { type: "textContains", text: draft.text };
    case "hasDescription":
      return { type: "hasDescription", value: draft.boolValue };
  }
}

export function criterionDraftToExpression(draft: CriterionDraft): FilterExpression {
  const criterion: FilterExpression = { type: "criterion", criterion: criterionDraftToCriterion(draft) };
  return draft.isNegated ? { type: "not", expression: criterion } : criterion;
}

// --- FlatFilter --------------------------------------------------------------------------

/** One "Match All / Match Any" selector over a flat list of (optionally negated)
 * criteria — the editor's whole filter-building surface. Maps directly onto
 * `and([...])`/`or([...])` with `not` on individual criteria, per this feature's
 * scoping decision to support §6.7's boolean composition without a full nested-group
 * editor; `FilterExpression` itself still supports arbitrary nesting, so this is an
 * editor-shape decision, not a model limitation. */
export type MatchMode = "all" | "any";

export interface FlatFilter {
  mode: MatchMode;
  rows: CriterionDraft[];
}

function rowFromExpression(expression: FilterExpression): CriterionDraft | null {
  if (expression.type === "criterion") return criterionDraftFromCriterion(expression.criterion);
  if (expression.type === "not" && expression.expression.type === "criterion") {
    return criterionDraftFromCriterion(expression.expression.criterion, true);
  }
  return null;
}

function rowsFromChildren(children: readonly FilterExpression[]): CriterionDraft[] | null {
  if (children.length === 0) return null;
  const rows: CriterionDraft[] = [];
  for (const child of children) {
    const row = rowFromExpression(child);
    if (row === null) return null;
    rows.push(row);
  }
  return rows;
}

/** `null` means the expression is not representable as a flat Match-All/Any list —
 * nested groups, an expression that mixes AND and OR, or anything deeper than one level
 * of `not` directly around a criterion. The editor must show such a filter read-only
 * rather than silently flattening (and thereby corrupting) it. */
export function flatFilterFromExpression(expression: FilterExpression): FlatFilter | null {
  switch (expression.type) {
    case "and": {
      const rows = rowsFromChildren(expression.expressions);
      return rows === null ? null : { mode: "all", rows };
    }
    case "or": {
      const rows = rowsFromChildren(expression.expressions);
      return rows === null ? null : { mode: "any", rows };
    }
    case "criterion":
    case "not": {
      const row = rowFromExpression(expression);
      return row === null ? null : { mode: "all", rows: [row] };
    }
  }
}

/** Always emits a canonical `and([...])`/`or([...])` wrapper, even for a single row — so
 * re-saving a list whose stored filter was a bare top-level `criterion`/`not` (never
 * something this editor itself produces; only possible from a hand-built fixture or a
 * future format) changes its shape to `and([that same node])`. Semantically identical (a
 * one-element AND/OR matches exactly what its element matches) and never happens twice —
 * the second save already has the canonical shape. */
export function flatFilterToExpression(filter: FlatFilter): FilterExpression {
  const expressions = filter.rows.map(criterionDraftToExpression);
  return filter.mode === "any" ? { type: "or", expressions } : { type: "and", expressions };
}
