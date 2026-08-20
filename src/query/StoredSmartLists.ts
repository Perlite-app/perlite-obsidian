import type { SmartList } from "./SmartList.js";

/**
 * The persisted shape backing user-defined smart lists (§6.8) — CRUD, display order,
 * pinning, and which built-ins are hidden. Built-ins are referenced by id, never copied
 * into this file, so a future change to a built-in's own rule (`BuiltInSmartLists.ts`)
 * reaches existing users instead of being frozen at whatever it was on first launch.
 *
 * **Storage location, confirmed 2026-08-20**: unlike the native app (still App-Group-
 * local as of this port, a pending migration tracked separately), this plugin stores
 * this file in the vault itself (`SmartListStore.ts`) — the decision recorded in the
 * plan doc's "Smart list storage" section, since a plugin has no per-device App Group
 * equivalent and the whole point of a shared wire format (`queryCoding.ts`) is to let
 * every implementation read the same vault-relative file.
 *
 * Field names mirror `PerliteCore` (App target)'s `SmartListStore.StoredSmartLists`
 * exactly, so a future migration of the native app onto vault storage needs no field
 * renaming to interoperate with a vault this plugin already wrote to.
 */
export interface StoredSmartLists {
  readonly schemaVersion: number;
  readonly lists: readonly SmartList[];
  readonly order: readonly string[];
  readonly pinnedIDs: readonly string[];
  readonly hiddenBuiltInIDs: readonly string[];
}

export const CURRENT_SMART_LIST_SCHEMA_VERSION = 1;

export const EMPTY_STORED_SMART_LISTS: StoredSmartLists = {
  schemaVersion: CURRENT_SMART_LIST_SCHEMA_VERSION,
  lists: [],
  order: [],
  pinnedIDs: [],
  hiddenBuiltInIDs: [],
};
