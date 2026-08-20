import { DEFAULT_PARSER_CONFIGURATION, type ParserConfiguration } from "./parser/ParserConfiguration.js";

/**
 * The plugin's own persisted settings (`this.loadData()`/`this.saveData()`, a plain
 * JSON file in the plugin's data directory — Obsidian's standard mechanism, the rough
 * platform equivalent of the native app's `UserDefaults`-backed `AppSettings`).
 *
 * Wave 1 chunk 9's deliberately minimal scope, mirroring the native app's own chunk-3
 * precedent exactly: "only the global filter (toggle + tag text), since that's the one
 * setting real-device testing showed was actually blocking use" — plus folder
 * exclusions, named explicitly in this plan's own Wave 1 chunk 7/9 bullets. Everything
 * else `ParserConfiguration` models (`filenameAsScheduledDate`,
 * `frontmatterTagInheritance`) stays at its default until a later chunk gives it a
 * settings-tab control and a reason to expose one.
 */
export interface PerliteSettings {
  /** Whether the `#task` global filter is enforced at all. Mirrors
   * `ParserConfiguration.globalFilter`'s `string | null` shape as two separate fields
   * instead of one nullable one — a plain settings-tab `Toggle` + `Text` pair reads more
   * naturally than a single nullable-string control, and `parserConfiguration()` below
   * is the one place that recombines them. */
  readonly globalFilterEnabled: boolean;
  readonly globalFilterTag: string;
  /** Vault-relative folder paths to skip entirely when scanning — see
   * `write/vaultScan.ts`. */
  readonly excludedFolders: readonly string[];
}

export const DEFAULT_SETTINGS: PerliteSettings = {
  globalFilterEnabled: true,
  globalFilterTag: DEFAULT_PARSER_CONFIGURATION.globalFilter ?? "#task",
  excludedFolders: [],
};

/** Builds the `ParserConfiguration` every parse call in this plugin uses, from the
 * plugin's own persisted settings — the one place the two shapes are reconciled, so a
 * future settings-tab field never has to know `ParserConfiguration`'s own shape
 * directly. */
export function parserConfiguration(settings: PerliteSettings): ParserConfiguration {
  return {
    ...DEFAULT_PARSER_CONFIGURATION,
    globalFilter: settings.globalFilterEnabled ? settings.globalFilterTag : null,
    excludedFolders: settings.excludedFolders,
  };
}
