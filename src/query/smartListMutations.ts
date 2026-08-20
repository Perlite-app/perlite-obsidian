import * as BuiltInSmartLists from "./BuiltInSmartLists.js";
import { mergeSmartListCatalog } from "./smartListCatalog.js";
import type { SmartList } from "./SmartList.js";
import type { StoredSmartLists } from "./StoredSmartLists.js";

/**
 * Pure CRUD/reorder/hide transforms over `StoredSmartLists` — each returns a new value,
 * never mutates its input, so `main.ts`'s `mutateSmartLists` can apply one, persist it,
 * and roll back to the original on a save failure without any transform needing to know
 * about that failure-handling concern itself.
 */

function currentOrder(stored: StoredSmartLists): string[] {
  // `order` may not yet mention every id (a freshly-created list, or the very first
  // save ever) — `mergeSmartListCatalog` already resolves that by appending anything
  // missing, so deriving a *complete* order from it (rather than trusting
  // `stored.order` verbatim) is what makes move-up/move-down and reordering-after-create
  // behave correctly on the very first use, not just after a list has been explicitly
  // reordered once already.
  return mergeSmartListCatalog(stored).map((list) => list.id);
}

export function withCreatedList(stored: StoredSmartLists, list: SmartList): StoredSmartLists {
  return {
    ...stored,
    lists: [...stored.lists, list],
    order: [...currentOrder(stored), list.id],
  };
}

export function withUpdatedList(stored: StoredSmartLists, list: SmartList): StoredSmartLists {
  return { ...stored, lists: stored.lists.map((existing) => (existing.id === list.id ? list : existing)) };
}

export function withDeletedList(stored: StoredSmartLists, id: string): StoredSmartLists {
  return {
    ...stored,
    lists: stored.lists.filter((list) => list.id !== id),
    order: stored.order.filter((existing) => existing !== id),
    pinnedIDs: stored.pinnedIDs.filter((existing) => existing !== id),
  };
}

export function withToggledHiddenBuiltIn(stored: StoredSmartLists, id: string): StoredSmartLists {
  const isHidden = stored.hiddenBuiltInIDs.includes(id);
  return {
    ...stored,
    hiddenBuiltInIDs: isHidden ? stored.hiddenBuiltInIDs.filter((existing) => existing !== id) : [...stored.hiddenBuiltInIDs, id],
  };
}

/** Swaps `id` with its immediate neighbour in the *effective* display order (built-ins
 * + user lists merged) — a no-op at either end of the list. */
export function withMovedList(stored: StoredSmartLists, id: string, direction: "up" | "down"): StoredSmartLists {
  const order = currentOrder(stored);
  const index = order.indexOf(id);
  if (index === -1) return stored;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= order.length) return stored;
  const reordered = [...order];
  [reordered[index], reordered[targetIndex]] = [reordered[targetIndex]!, reordered[index]!];
  return { ...stored, order: reordered };
}

/** Every built-in id, even ones never explicitly touched — so a freshly-installed
 * vault's very first save writes a complete, stable `order` rather than an empty one
 * that only grows as the user happens to reorder or create something. */
export function withNormalizedOrder(stored: StoredSmartLists): StoredSmartLists {
  return { ...stored, order: currentOrder(stored) };
}

export function isBuiltInID(id: string): boolean {
  return BuiltInSmartLists.all.some((list) => list.id === id);
}
