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
  /** Vault-relative path Wave 2 chunk 13's quick-capture command appends to — created
   * (with any missing parent folder) on first capture if it doesn't exist yet. */
  readonly defaultInboxFile: string;
  /** No longer read since the design pass — the Today lens always shows what was done
   * today, greyed, and counts it in the progress ring. Kept so an older settings file
   * still loads without a migration. */
  readonly showCompletedToday: boolean;
  /** Whether navigating between Perlite views (smart lists hub, a smart list's own
   * detail, a tapped tag's detail) reuses one tracked leaf — `PerlitePlugin.openPerliteView`
   * repoints it via `setViewState` on every navigation, so it always reads as "pushed
   * over the standard task list" with a single back button returning to it — versus each
   * distinct destination getting (or reusing) its own dedicated tab, for anyone who wants
   * several Perlite views open side by side. Defaults on: it's also what fixes a latent
   * bug the "off" behavior never had — `activateListView`/`activateSmartListsView` used
   * to look up their target leaf by view type alone, which silently spawned a duplicate
   * tab once the original leaf had been repointed to a deeper view. */
  readonly singleTabNavigation: boolean;
  /** The design pass's main-tab state, kept across restarts: the selected lens
   * (`query/lenses.ts`'s `lensKey`), List/Board/Calendar mode, and each mode's own
   * options. Saved without a vault rescan (`PerlitePlugin.saveViewState`). */
  readonly view: PerliteViewSettings;
}

export type PerliteMode = "list" | "board" | "calendar";
export type BoardColumns = "status" | "priority" | "note";
export type CalendarField = "due" | "scheduled" | "start";
export type CalendarRange = "week" | "month";

export interface PerliteViewSettings {
  readonly lens: string;
  readonly mode: PerliteMode;
  readonly grouping: "note" | "due" | "priority";
  readonly boardColumns: BoardColumns;
  readonly calendarField: CalendarField;
  readonly calendarRange: CalendarRange;
}

export const DEFAULT_VIEW_SETTINGS: PerliteViewSettings = {
  lens: "today",
  mode: "list",
  grouping: "note",
  boardColumns: "status",
  calendarField: "due",
  calendarRange: "week",
};

export const DEFAULT_SETTINGS: PerliteSettings = {
  globalFilterEnabled: true,
  globalFilterTag: DEFAULT_PARSER_CONFIGURATION.globalFilter ?? "#task",
  excludedFolders: [],
  defaultInboxFile: "Inbox.md",
  showCompletedToday: false,
  singleTabNavigation: true,
  view: DEFAULT_VIEW_SETTINGS,
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
