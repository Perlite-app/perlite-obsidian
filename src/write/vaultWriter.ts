import type { App, TFile } from "obsidian";
import { splitLines } from "../parser/DocumentParser.js";
import { applyEdit, DocumentEditError, type DocumentEdit, type LineDocument } from "./documentEditor.js";

/**
 * The one place this plugin calls `app.vault.process` — Obsidian's atomic
 * read-modify-write, the mapping of the native app's `NSFileCoordinator`-serialised
 * write onto this platform (see the plan's "Write-safety layer" table). Preferred over
 * a separate `vault.read` + `vault.modify` pair specifically because that gap is the
 * exact read-then-write race §6.4 exists to close: `process`'s callback runs against
 * whatever the file's *current* content actually is at write time, not a possibly-stale
 * snapshot read earlier, so `edit.locate`'s content match is always checked against the
 * freshest possible data. `minAppVersion` (`manifest.json`) is pinned to `1.5.0`, well
 * above `process`'s own `1.1.0` floor.
 *
 * Deliberately thin and **not unit-testable** — same standing limitation
 * `VaultWriter.swift` has on the native side (needs a real coordinator/file system);
 * `documentEditor.ts`'s own pure logic carries all the real test coverage. Verification
 * here means running the plugin against a real Obsidian vault (`npm run dev`), the same
 * "David verifies this the same way he verifies native-app UI/animation work" posture
 * the plan's own testing section already sets.
 *
 * Only ever throws `DocumentEditError` (content changed since the caller last read it —
 * propagate as a user-visible "couldn't save, please retry" per §6.4, never guess or
 * retry silently) or whatever `app.vault.process` itself throws (a real I/O failure).
 */
export async function writeDocumentEdit(
  app: App,
  file: TFile,
  edit: DocumentEdit,
  preferringLineIndex: number | null,
): Promise<void> {
  let editError: DocumentEditError | null = null;
  await app.vault.process(file, (data) => {
    const document: LineDocument = { lines: splitLines(data) };
    try {
      return applyEdit(edit, document, preferringLineIndex);
    } catch (error) {
      if (error instanceof DocumentEditError) {
        editError = error;
        // `process`'s callback must return synchronously with the intended content —
        // there is no way to abort the write from inside it, so this returns the
        // untouched original data (a no-op write) and the caller is told to treat this
        // exactly like a thrown error via the rethrow below, once `process` resolves.
        return data;
      }
      throw error;
    }
  });
  if (editError !== null) throw editError;
}
