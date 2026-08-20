import { isSyncConflictPath } from "./conflictDetection.js";

/**
 * Decides which of the vault's markdown files should actually be read and parsed —
 * applied *before* any file content is touched, per §6.1's provider-agnostic scanning
 * requirement and §6.4's conflict-file rule. Pure over a list of vault-relative paths;
 * the real `app.vault.getMarkdownFiles()` enumeration (Wave 1 chunk 8, the list lens)
 * is the only Obsidian-API-dependent step, kept out of this file entirely so the
 * exclusion/conflict logic itself stays independently unit-testable.
 */
export interface VaultScanPlan {
  /** Files to actually read and parse. */
  readonly included: readonly string[];
  /** Sync-conflict copies — never parsed, surfaced as a non-blocking notice instead. */
  readonly conflictPaths: readonly string[];
}

/** Normalises a configured exclusion entry (`excludedFolders`) to a bare, no-trailing-
 * slash vault-relative folder path, so `"Archive/"`/`"Archive"` both match identically. */
function normalizeFolder(folder: string): string {
  return folder.replace(/\/+$/, "");
}

/** A file is excluded when it lives *inside* an excluded folder (a strict path-segment
 * prefix, not a bare string prefix — `"Archive"` must not exclude `"Archived.md"`). */
function isInExcludedFolder(filePath: string, excludedFolders: readonly string[]): boolean {
  return excludedFolders.some((raw) => {
    const folder = normalizeFolder(raw);
    if (folder.length === 0) return false;
    return filePath === folder || filePath.startsWith(folder + "/");
  });
}

export function planVaultScan(allMarkdownPaths: readonly string[], excludedFolders: readonly string[]): VaultScanPlan {
  const included: string[] = [];
  const conflictPaths: string[] = [];
  for (const path of allMarkdownPaths) {
    if (isInExcludedFolder(path, excludedFolders)) continue;
    if (isSyncConflictPath(path)) {
      conflictPaths.push(path);
      continue;
    }
    included.push(path);
  }
  return { included, conflictPaths };
}
