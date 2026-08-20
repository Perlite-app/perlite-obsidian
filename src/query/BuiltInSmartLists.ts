import type { FilterExpression } from "./FilterCriterion.js";
import { createSmartList, type SmartList } from "./SmartList.js";

/**
 * The built-in system smart lists present on first launch with no configuration (§6.8's
 * table), minus `Blocking` — that one needs the dependency graph deferred to the
 * roadmap's Phase 2, since `🆔`/`⛔` are parsed but no reverse-dependency query exists
 * yet. Rules are transcribed as literally as the spec table states them: note that
 * `Overdue` checks only `due` (not `scheduled`), while `Today` and `Upcoming` check
 * both — and that `Upcoming`'s row has no "not done" qualifier in the table, unlike the
 * other four, so none is applied here.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Query/BuiltInSmartLists.swift`. Quick
 * Add's rule-inversion capture defaults (`SmartListInversion.swift`) are deliberately
 * not ported here yet — that's chunk 13's concern, not this one's.
 */

function dateOverdueOrToday(field: "dueDate" | "scheduledDate"): FilterExpression {
  return {
    type: "or",
    expressions: [
      { type: "criterion", criterion: { type: field, range: { type: "relative", value: "overdue" } } },
      { type: "criterion", criterion: { type: field, range: { type: "relative", value: "today" } } },
    ],
  };
}

/** "Priority high or highest" — factored out of `flagged`'s own filter so the Tasks
 * view's flagged-only filter can AND this same expression onto whatever it's already
 * showing instead of a second literal copy that could drift from the smart list's own
 * definition. */
export const flaggedPriority: FilterExpression = {
  type: "or",
  expressions: [
    { type: "criterion", criterion: { type: "priority", value: "highest" } },
    { type: "criterion", criterion: { type: "priority", value: "high" } },
  ],
};

const notDone: FilterExpression = { type: "not", expression: { type: "criterion", criterion: { type: "status", kind: "done" } } };

export const today: SmartList = createSmartList({
  id: "builtin.today",
  name: "Today",
  icon: "calendar",
  accentToken: "smartlist.today",
  filter: {
    type: "and",
    expressions: [{ type: "or", expressions: [dateOverdueOrToday("dueDate"), dateOverdueOrToday("scheduledDate")] }, notDone],
  },
  isBuiltIn: true,
});

export const overdue: SmartList = createSmartList({
  id: "builtin.overdue",
  name: "Overdue",
  icon: "triangle-alert",
  accentToken: "smartlist.overdue",
  filter: {
    type: "and",
    expressions: [
      { type: "criterion", criterion: { type: "dueDate", range: { type: "relative", value: "overdue" } } },
      notDone,
    ],
  },
  isBuiltIn: true,
});

export const upcoming: SmartList = createSmartList({
  id: "builtin.upcoming",
  name: "Upcoming",
  icon: "calendar-days",
  accentToken: "smartlist.upcoming",
  filter: {
    type: "or",
    expressions: [
      { type: "criterion", criterion: { type: "dueDate", range: { type: "relative", value: "next7Days" } } },
      { type: "criterion", criterion: { type: "scheduledDate", range: { type: "relative", value: "next7Days" } } },
    ],
  },
  isBuiltIn: true,
});

export const anytime: SmartList = createSmartList({
  id: "builtin.anytime",
  name: "Anytime",
  icon: "inbox",
  accentToken: "smartlist.anytime",
  filter: {
    type: "and",
    expressions: [
      { type: "criterion", criterion: { type: "dueDate", range: { type: "none" } } },
      { type: "criterion", criterion: { type: "scheduledDate", range: { type: "none" } } },
      { type: "criterion", criterion: { type: "startDate", range: { type: "none" } } },
      notDone,
    ],
  },
  isBuiltIn: true,
});

export const flagged: SmartList = createSmartList({
  id: "builtin.flagged",
  name: "Flagged",
  icon: "flag",
  accentToken: "smartlist.flagged",
  filter: { type: "and", expressions: [flaggedPriority, notDone] },
  isBuiltIn: true,
});

export const recentlyCompleted: SmartList = createSmartList({
  id: "builtin.recentlyCompleted",
  name: "Recently completed",
  icon: "circle-check",
  accentToken: "smartlist.recentlyCompleted",
  filter: {
    type: "and",
    expressions: [
      { type: "criterion", criterion: { type: "status", kind: "done" } },
      { type: "criterion", criterion: { type: "doneDate", range: { type: "relative", value: "last7Days" } } },
    ],
  },
  isBuiltIn: true,
});

/** Display order for first launch, matching the spec table's own order (minus
 * `Blocking`). */
export const all: readonly SmartList[] = [today, overdue, upcoming, anytime, flagged, recentlyCompleted];
