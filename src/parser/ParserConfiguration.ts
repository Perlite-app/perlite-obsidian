/**
 * Vault-wide parsing behaviour, threaded through every parse call rather than held as
 * global state.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Support/ParserConfiguration.swift`.
 */
export interface ParserConfiguration {
  /** A checkbox line must contain this tag to be treated as a task. `null` disables the
   * filter. Defaults to `#task` — real vaults surface every checkbox in every note
   * without it, making the plugin unusable on first run, so assume it is on. */
  readonly globalFilter: string | null;

  /** When true, a dateless task in a daily note named `YYYY-MM-DD.md` is treated as
   * scheduled for that date. Computed at read time only — never written back to the
   * file. Not used until `DocumentParser` (Wave 1 chunk 4). */
  readonly filenameAsScheduledDate: boolean;

  /** When true, inline tasks inherit `tags:` from their file's YAML frontmatter,
   * case-insensitively deduplicated against the task's own tags. Display-only. Not used
   * until `DocumentParser` (Wave 1 chunk 4). */
  readonly frontmatterTagInheritance: boolean;

  /** Vault-relative folder paths to skip entirely. Applied at the vault-scan level
   * (`write/vaultScan.ts`, Wave 1 chunk 7) — a whole-file decision made before any file
   * content is read, not something `DocumentParser` (which only ever sees one file's
   * own content) could apply itself. Kept here, not in a separate settings type, since
   * it's still vault-wide parsing behaviour in the same sense `globalFilter` is. */
  readonly excludedFolders: readonly string[];
}

export const DEFAULT_PARSER_CONFIGURATION: ParserConfiguration = {
  globalFilter: "#task",
  filenameAsScheduledDate: false,
  frontmatterTagInheritance: false,
  excludedFolders: [],
};
