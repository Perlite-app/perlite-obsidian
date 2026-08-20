import { decodeSmartList, encodeSmartList } from "./queryCoding.js";
import { CURRENT_SMART_LIST_SCHEMA_VERSION, type StoredSmartLists } from "./StoredSmartLists.js";

/**
 * Pure encode/decode for `StoredSmartLists` — no Obsidian API surface, so this is
 * independently unit-testable exactly like `queryCoding.ts` itself. `SmartListStore.ts`
 * is the thin, Obsidian-dependent shell that reads/writes this shape to a vault file.
 */

function expectStringArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Expected a string array for ${context}, got ${JSON.stringify(value)}`);
  }
  return value as string[];
}

export function encodeStoredSmartLists(stored: StoredSmartLists): unknown {
  return {
    schemaVersion: stored.schemaVersion,
    lists: stored.lists.map(encodeSmartList),
    order: stored.order,
    pinnedIDs: stored.pinnedIDs,
    hiddenBuiltInIDs: stored.hiddenBuiltInIDs,
  };
}

export function decodeStoredSmartLists(value: unknown): StoredSmartLists {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected an object for StoredSmartLists, got ${JSON.stringify(value)}`);
  }
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.lists)) throw new Error("StoredSmartLists.lists must be an array");
  return {
    schemaVersion: typeof obj.schemaVersion === "number" ? obj.schemaVersion : CURRENT_SMART_LIST_SCHEMA_VERSION,
    lists: obj.lists.map(decodeSmartList),
    order: expectStringArray(obj.order, "StoredSmartLists.order"),
    pinnedIDs: expectStringArray(obj.pinnedIDs, "StoredSmartLists.pinnedIDs"),
    hiddenBuiltInIDs: expectStringArray(obj.hiddenBuiltInIDs, "StoredSmartLists.hiddenBuiltInIDs"),
  };
}
