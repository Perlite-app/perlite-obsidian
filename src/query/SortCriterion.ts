/**
 * A field a task list can be sorted by. MVP §6.7's own example is "priority then due
 * date" — multi-level, via an ordered list of these, not a single key.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Query/SortCriterion.swift`.
 */
export type SortKey = "dueDate" | "scheduledDate" | "startDate" | "priority" | "status" | "description";

export const SORT_KEY_VALUES: readonly SortKey[] = ["dueDate", "scheduledDate", "startDate", "priority", "status", "description"];

export type SortDirection = "ascending" | "descending";

/** One level of a multi-level sort. `direction` is user-configurable per §6.7; the
 * *meaning* of ascending is documented per key on `SortEngine` since it isn't always the
 * obvious "smaller value first" (priority in particular: ascending means highest
 * priority first, matching how "sorted by priority" reads in this class of app). */
export interface SortCriterion {
  readonly key: SortKey;
  readonly direction: SortDirection;
}

export function sortCriterion(key: SortKey, direction: SortDirection = "ascending"): SortCriterion {
  return { key, direction };
}
