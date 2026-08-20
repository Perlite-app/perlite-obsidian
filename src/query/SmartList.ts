import type { FilterExpression } from "./FilterCriterion.js";
import type { GroupKey } from "./GroupingEngine.js";
import type { SortCriterion } from "./SortCriterion.js";

/**
 * Wave 3: which renderer a smart list's own filtered/sorted tasks display through —
 * "one query, many renderers" (the plan's own framing), so this lives as a persisted
 * property of the list itself rather than a separate view-type concept. `"kanban"` reads
 * `grouping` as its column key (falling back to `"status"` if unset — see
 * `SmartListEditorModal`'s save-time default); `"calendar"` ignores `grouping` entirely
 * and buckets by `CalendarIndex.anchorDate` instead.
 */
export type SmartListLens = "list" | "kanban" | "calendar";

export const SMART_LIST_LENS_VALUES: readonly SmartListLens[] = ["list", "kanban", "calendar"];

/**
 * A named, rule-based view that evaluates live against the vault (§6.8) — never a
 * stored set of task IDs, so a matching task added in Obsidian appears on next refresh
 * with no user action. Built-in and user-defined lists share this one type; there is no
 * separate "saved list" concept.
 *
 * `icon` and `accentToken` are opaque identifiers — a Lucide icon name and a design
 * token name respectively (§5) — resolved to an actual glyph/colour by the view layer.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Query/SmartList.swift`.
 */
export interface SmartList {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly accentToken: string;
  readonly filter: FilterExpression;
  /** The list's preferred grouping, applied by the caller via `GroupingEngine.group` on
   * `SmartListResult.tasks` — `SmartListEngine` only filters, counts and sorts, it
   * doesn't group, since grouping reshapes a flat task array into sections and that
   * reshaping is a display-time step, not something to bake into the single-pass scan. */
  readonly grouping: GroupKey | null;
  readonly sorting: readonly SortCriterion[];
  /** Built-ins can be hidden but not deleted, per §6.8; this flag is what the Smart
   * Lists view checks before allowing deletion. */
  readonly isBuiltIn: boolean;
  readonly lens: SmartListLens;
}

export function createSmartList(
  input: Omit<SmartList, "grouping" | "sorting" | "isBuiltIn" | "lens"> &
    Partial<Pick<SmartList, "grouping" | "sorting" | "isBuiltIn" | "lens">>,
): SmartList {
  return {
    grouping: null,
    sorting: [],
    isBuiltIn: false,
    lens: "list",
    ...input,
  };
}
