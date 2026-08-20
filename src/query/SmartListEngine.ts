import type { CalendarDate } from "../model/CalendarDate.js";
import type { ParsedTask } from "../model/ParsedTask.js";
import { matches } from "./FilterEngine.js";
import * as SortEngine from "./SortEngine.js";
import type { SmartList } from "./SmartList.js";

/**
 * One smart list's evaluated contents. `count` is the badge count — computed from the
 * same pass that produced `tasks`, never a separate query.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Query/SmartListEngine.swift`.
 */
export interface SmartListResult {
  readonly smartList: SmartList;
  readonly tasks: readonly ParsedTask[];
}

export function resultCount(result: SmartListResult): number {
  return result.tasks.length;
}

/** Evaluates every smart list against a task set in one pass. §6.8's performance
 * requirement is explicit: "all smart list contents and badge counts derive from a
 * single in-memory pass... do not run a separate count query per list, that is an N+1
 * pass over the vault." `evaluate` iterates `tasks` exactly once, checking every list's
 * filter per task as it goes, rather than calling `FilterEngine.apply` once per list
 * (which would re-scan the full array once per list). */
export function evaluate(tasks: readonly ParsedTask[], smartLists: readonly SmartList[], today: CalendarDate): SmartListResult[] {
  const buckets: ParsedTask[][] = smartLists.map(() => []);
  for (const task of tasks) {
    for (let i = 0; i < smartLists.length; i++) {
      if (matches(task, smartLists[i]!.filter, today)) buckets[i]!.push(task);
    }
  }
  return smartLists.map((smartList, i) => ({
    smartList,
    // An empty `sorting` list is a safe no-op — `SortEngine.sort` preserves original
    // order when it has no criteria to apply.
    tasks: SortEngine.sort(buckets[i]!, smartList.sorting),
  }));
}
