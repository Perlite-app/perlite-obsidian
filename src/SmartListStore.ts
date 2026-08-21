import type { App } from "obsidian";
import { decodeStoredSmartLists, encodeStoredSmartLists } from "./query/smartListCoding.js";
import { EMPTY_STORED_SMART_LISTS, type StoredSmartLists } from "./query/StoredSmartLists.js";

/**
 * Persists user-defined smart lists (§6.8) to a vault file — **the confirmed 2026-08-20
 * storage decision**: not the plugin's own `data.json` (which lives outside the vault,
 * per-device, and no other implementation could ever read), but a real file inside the
 * vault itself, so a future Android/Kotlin implementation — or a migrated native app —
 * reads the exact same definitions. Deliberately **not** a throwaway cache like
 * `VaultCache`/`WidgetSnapshot` are on the native side: a user's hand-built filter has no
 * source of truth to regenerate from, so a corrupt file here must never be silently
 * discarded or overwritten by the next save.
 *
 * Stored at `.perlite/smart-lists.json` — a dot-prefixed folder (Obsidian's own
 * convention for `.obsidian/`) keeps it out of the file explorer and out of Obsidian's
 * own note index, so `app.vault.adapter` (raw path-based read/write) is used rather than
 * the higher-level `Vault.process`/`Vault.create` API, which is scoped to indexed
 * `TFile`s. This is the one file in the plugin that reads/writes outside that indexed
 * API — every task-line mutation still goes through `write/vaultWriter.ts`'s
 * `Vault.process` wrapper unchanged.
 */

const STORE_DIR = ".perlite";
const STORE_PATH = `${STORE_DIR}/smart-lists.json`;

function corruptFilePath(): string {
  return `${STORE_DIR}/smart-lists.corrupt-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
}

export type SmartListLoadResult =
  | { readonly kind: "notFound" }
  | { readonly kind: "loaded"; readonly stored: StoredSmartLists }
  /** The file existed but failed to decode. `preservedAt` is where the unreadable
   * original was moved (never deleted) so it isn't lost to a future accidental save, and
   * remains available if manual recovery is ever needed. */
  | { readonly kind: "corrupt"; readonly preservedAt: string }
  /** The file exists (confirmed via `adapter.exists`) but `adapter.read` itself threw —
   * a transient I/O error, not a decode failure, so there's nothing to rename: the
   * original is untouched on disk. Deliberately **not** folded into `"notFound"` (an
   * earlier version of this code did exactly that): a caller that treats a read error as
   * "nothing saved yet" starts from an empty in-memory store, and this store's own
   * mutation path (`main.ts`'s `mutateSmartLists`) always persists from whatever's
   * in-memory — so the very next smart-list create/edit would silently overwrite the
   * real, still-present file with that empty state. That's exactly the "never silently
   * discarded or overwritten" failure this module's own doc comment rules out. */
  | { readonly kind: "readError" };

export async function loadStoredSmartLists(app: App): Promise<SmartListLoadResult> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(STORE_PATH))) return { kind: "notFound" };

  let raw: string;
  try {
    raw = await adapter.read(STORE_PATH);
  } catch {
    return { kind: "readError" };
  }

  try {
    const stored = decodeStoredSmartLists(JSON.parse(raw));
    return { kind: "loaded", stored };
  } catch {
    const preservedAt = corruptFilePath();
    try {
      await adapter.rename(STORE_PATH, preservedAt);
    } catch {
      // If even the rename fails, there's nothing safer left to do than report notFound
      // — the corrupt file stays exactly where it was rather than risking data loss by
      // attempting to delete or overwrite it.
      return { kind: "notFound" };
    }
    return { kind: "corrupt", preservedAt };
  }
}

/** Best-effort load for callers that only need *a* usable list of definitions and have
 * no UI to surface a corrupt-file notice — falls back to an empty store on either
 * `notFound` or `corrupt`, matching the native app's `SmartListCatalog.loadAll`'s own
 * "never returns nothing, `BuiltInSmartLists.all` is always available via the caller's
 * own merge" posture. */
export async function loadStoredSmartListsOrEmpty(app: App): Promise<StoredSmartLists> {
  const result = await loadStoredSmartLists(app);
  return result.kind === "loaded" ? result.stored : EMPTY_STORED_SMART_LISTS;
}

/** Returns `false` on any encode/write failure so the caller can roll back its
 * in-memory change and surface it, rather than the two silently drifting apart. */
export async function saveStoredSmartLists(app: App, stored: StoredSmartLists): Promise<boolean> {
  const adapter = app.vault.adapter;
  try {
    if (!(await adapter.exists(STORE_DIR))) {
      await adapter.mkdir(STORE_DIR);
    }
    await adapter.write(STORE_PATH, JSON.stringify(encodeStoredSmartLists(stored), null, 2));
    return true;
  } catch {
    return false;
  }
}
