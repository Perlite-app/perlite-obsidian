/**
 * Sync-conflict file detection — the same filename patterns the native app's
 * `VaultReader.swift` checks (`.sync-conflict-` for iCloud Drive, `(conflicted copy)`
 * for Dropbox/Google Drive; Obsidian Sync and third-party sync clients both produce
 * these). A conflict file must never be parsed as a task source or silently picked as a
 * winner — excluded from scanning, surfaced as a non-blocking notice instead, per §6.4.
 */
export function isSyncConflictPath(filePath: string): boolean {
  return filePath.includes(".sync-conflict-") || filePath.includes("(conflicted copy");
}
