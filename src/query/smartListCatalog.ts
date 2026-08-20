import * as BuiltInSmartLists from "./BuiltInSmartLists.js";
import type { SmartList } from "./SmartList.js";
import type { StoredSmartLists } from "./StoredSmartLists.js";

/**
 * Merges `BuiltInSmartLists.all` with a `StoredSmartLists`'s user-defined lists into one
 * ordered array — the single implementation every view that lists smart lists (the hub,
 * the widget's own list picker once one exists) calls, rather than divergent copies of
 * the same merge logic.
 *
 * 1:1 port of the native app's `SmartListCatalog.all(from:)`. Hidden built-ins are
 * deliberately **included** here, not filtered out — existing routes resolve a built-in
 * by id regardless of hidden state; only hub *rendering* filters them. Anything present
 * in `BuiltInSmartLists.all` or `stored.lists` but missing from `stored.order` is
 * appended at the end rather than dropped.
 */
export function mergeSmartListCatalog(stored: StoredSmartLists): SmartList[] {
  const builtInsByID = new Map(BuiltInSmartLists.all.map((list) => [list.id, list]));
  const userByID = new Map(stored.lists.map((list) => [list.id, list]));
  const ordered: SmartList[] = [];
  const seen = new Set<string>();

  for (const id of stored.order) {
    if (seen.has(id)) continue;
    const list = builtInsByID.get(id) ?? userByID.get(id);
    if (list !== undefined) {
      ordered.push(list);
      seen.add(id);
      userByID.delete(id);
    }
  }
  for (const list of BuiltInSmartLists.all) {
    if (!seen.has(list.id)) {
      ordered.push(list);
      seen.add(list.id);
    }
  }
  for (const list of stored.lists) {
    if (!seen.has(list.id)) {
      ordered.push(list);
      seen.add(list.id);
    }
  }
  return ordered;
}
