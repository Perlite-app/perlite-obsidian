import { Events, type App } from "obsidian";
import type { CalendarDate } from "../model/CalendarDate.js";
import { mergeSmartListCatalog } from "../query/smartListCatalog.js";
import type { SmartList } from "../query/SmartList.js";
import { parseLensKey, lensKey, type Lens } from "../query/lenses.js";
import { parserConfiguration, type PerliteSettings, type PerliteViewSettings } from "../settings.js";
import { todayCalendarDate } from "../support/today.js";
import { scanVaultTasks, type LocatedTask } from "../vaultTaskScan.js";

/**
 * The design pass's shared UI state — one object every Perlite surface reads: the main
 * tab, the "Perlite lenses" left-sidebar view, the "Task" right-sidebar view and the
 * status bar item. It holds the one vault scan they all render from (instead of each
 * view scanning on its own), the selected lens and mode, and the selected task.
 *
 * Events (Obsidian's own `Events`): `"data"` after a rescan, `"view"` when the lens,
 * mode or a mode option changes, `"selection"` when the selected task changes. Views
 * subscribe with `registerEvent(state.on(...))` so the subscription ends with the view.
 */
export class PerliteState extends Events {
  located: readonly LocatedTask[] = [];
  conflictPaths: readonly string[] = [];
  hasScanned = false;
  view: PerliteViewSettings;
  /** The week/month the calendar shows — navigation only, not persisted. */
  calendarAnchor: CalendarDate = todayCalendarDate();
  /** `filePath` + line index — survives a rescan as long as the line didn't move. */
  private selectedKey: string | null = null;
  private scanGeneration = 0;

  constructor(
    private readonly app: App,
    private readonly getSettings: () => PerliteSettings,
    private readonly getStoredSmartLists: () => Parameters<typeof mergeSmartListCatalog>[0],
    private readonly persistView: (view: PerliteViewSettings) => void,
  ) {
    super();
    this.view = getSettings().view;
  }

  get smartLists(): SmartList[] {
    return mergeSmartListCatalog(this.getStoredSmartLists());
  }

  get lens(): Lens {
    return parseLensKey(this.view.lens);
  }

  /** Re-reads every included note. Overlapping calls are fine: only the newest one's
   * result is kept. */
  async rescan(): Promise<void> {
    const generation = ++this.scanGeneration;
    const settings = this.getSettings();
    const result = await scanVaultTasks(this.app, settings.excludedFolders, parserConfiguration(settings));
    if (generation !== this.scanGeneration) return;
    this.located = result.located;
    this.conflictPaths = result.conflictPaths;
    this.hasScanned = true;
    this.trigger("data");
    this.trigger("selection");
  }

  updateView(partial: Partial<PerliteViewSettings>): void {
    this.view = { ...this.view, ...partial };
    this.persistView(this.view);
    this.trigger("view");
  }

  setLens(lens: Lens): void {
    this.updateView({ lens: lensKey(lens) });
  }

  select(entry: LocatedTask | null): void {
    const key = entry === null ? null : keyOf(entry);
    if (key === this.selectedKey) return;
    this.selectedKey = key;
    this.trigger("selection");
  }

  isSelected(entry: LocatedTask): boolean {
    return this.selectedKey !== null && keyOf(entry) === this.selectedKey;
  }

  get selected(): LocatedTask | null {
    if (this.selectedKey === null) return null;
    return this.located.find((entry) => keyOf(entry) === this.selectedKey) ?? null;
  }
}

function keyOf(entry: LocatedTask): string {
  return `${entry.file.path}\u0000${entry.task.location?.lineIndex ?? -1}`;
}
