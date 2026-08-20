import type { CalendarDate } from "../model/CalendarDate.js";
import type { Priority } from "../model/Priority.js";
import type { TaskStatusKind } from "../model/TaskStatus.js";

/**
 * A named relative date window, resolved against a `today` passed into `FilterEngine`
 * rather than computed internally — keeps filtering deterministic and testable, same
 * reasoning as `RecurrenceEngine.complete` taking `today` as a parameter.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Query/FilterCriterion.swift`.
 */
export type RelativeDateRange = "overdue" | "today" | "next7Days" | "last7Days";

/** A due/scheduled/start date filter. Absolute cases cover MVP §6.7's "date ranges";
 * `.relative` covers the three named windows the spec calls out explicitly. `date`/
 * `start`/`end` are real `CalendarDate` values here — the ISO-string wire shape is
 * `queryCoding.ts`'s job, not this file's, mirroring the Swift original's split between
 * the in-memory type (`FilterCriterion.swift`) and its `Codable` conformance
 * (`QueryCoding.swift`). */
export type DateRangeFilter =
  | { readonly type: "none" }
  | { readonly type: "before"; readonly date: CalendarDate }
  | { readonly type: "onOrAfter"; readonly date: CalendarDate }
  | { readonly type: "between"; readonly start: CalendarDate; readonly end: CalendarDate }
  | { readonly type: "relative"; readonly value: RelativeDateRange };

/** One filterable dimension from MVP §6.7. `ParsedTask` has no separate "notes" body
 * distinct from its title — everything after status/fields on a task's own line is
 * `description` — so "task title text" and "description text" from the spec collapse
 * into the single `textContains` case here rather than two dimensions over the same
 * field. */
export type FilterCriterion =
  | { readonly type: "status"; readonly kind: TaskStatusKind }
  | { readonly type: "priority"; readonly value: Priority }
  | { readonly type: "dueDate"; readonly range: DateRangeFilter }
  | { readonly type: "scheduledDate"; readonly range: DateRangeFilter }
  | { readonly type: "startDate"; readonly range: DateRangeFilter }
  /** Added for the "Recently completed" built-in smart list; not one of §6.7's listed
   * filter dimensions on its own, but the same `DateRangeFilter` machinery applies. */
  | { readonly type: "doneDate"; readonly range: DateRangeFilter }
  /** Case-insensitive exact tag match, e.g. `"#work"` matches only `#work`, not
   * `#work/urgent`. */
  | { readonly type: "tagExact"; readonly tag: string }
  /** Case-insensitive substring match against any of the task's tags. */
  | { readonly type: "tagContains"; readonly text: string }
  /** Case-insensitive substring match against the task's source file path. Never
   * matches a task with no `location`. */
  | { readonly type: "pathContains"; readonly text: string }
  /** Case-insensitive substring match against `description`. */
  | { readonly type: "textContains"; readonly text: string }
  /** `true` requires non-empty (whitespace-trimmed) description; `false` requires
   * empty. */
  | { readonly type: "hasDescription"; readonly value: boolean };

/** A boolean composition of filter criteria — MVP §6.7 explicitly calls out AND/OR
 * combinations, not just a flat ANDed list; nests arbitrarily (an OR of ANDs of ORs,
 * etc.) via recursive array/expression fields, the natural TS analogue of Swift's
 * `indirect enum`. `not` was added when the built-in smart lists (§6.8) turned out to
 * need "not done" repeatedly — negation composes more directly than trying to express
 * "not done" as a positive criterion over every other status kind. */
export type FilterExpression =
  | { readonly type: "criterion"; readonly criterion: FilterCriterion }
  | { readonly type: "and"; readonly expressions: readonly FilterExpression[] }
  | { readonly type: "or"; readonly expressions: readonly FilterExpression[] }
  | { readonly type: "not"; readonly expression: FilterExpression };
