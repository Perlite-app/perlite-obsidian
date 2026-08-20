import { ItemView, WorkspaceLeaf, type ViewStateResult } from "obsidian";
import { group, type TaskGroup } from "../query/GroupingEngine.js";
import { mergeSmartListCatalog } from "../query/smartListCatalog.js";
import * as SmartListEngine from "../query/SmartListEngine.js";
import { parserConfiguration } from "../settings.js";
import { todayCalendarDate } from "../support/today.js";
import { scanVaultTasks, type LocatedTask } from "../vaultTaskScan.js";
import { ListKeyboardNav, type KeyboardNavRow } from "./ListKeyboardNav.js";
import { renderInteractiveTaskRow } from "./taskRowInteractions.js";
import type PerlitePlugin from "../main.js";

/**
 * One smart list's evaluated contents — reached by tapping a row in
 * `PerliteSmartListsView`. Applies the list's own `grouping`/`sorting` exactly as
 * `SmartListEngine.evaluate` + `GroupingEngine.group` already compute them; this view
 * adds no filtering/sorting logic of its own. Shares `ListKeyboardNav` (Wave 2 chunk
 * 11) with `PerliteListView` — same keyboard triage here too.
 */
export const PERLITE_SMART_LIST_DETAIL_VIEW_TYPE = "perlite-smart-list-detail-view";

interface DetailState {
  readonly smartListId?: string;
}

export class PerliteSmartListDetailView extends ItemView {
  private readonly plugin: PerlitePlugin;
  readonly keyboardNav: ListKeyboardNav;
  private smartListId: string | null = null;
  private contentAreaEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PerlitePlugin) {
    super(leaf);
    this.plugin = plugin;
    this.keyboardNav = new ListKeyboardNav(this, this.app, plugin, () => this.refresh());
  }

  getViewType(): string {
    return PERLITE_SMART_LIST_DETAIL_VIEW_TYPE;
  }

  getDisplayText(): string {
    const list = mergeSmartListCatalog(this.plugin.smartLists).find((l) => l.id === this.smartListId);
    return list?.name ?? "Smart list";
  }

  getIcon(): string {
    const list = mergeSmartListCatalog(this.plugin.smartLists).find((l) => l.id === this.smartListId);
    return list?.icon ?? "flag";
  }

  getState(): Record<string, unknown> {
    return { smartListId: this.smartListId ?? undefined };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    this.smartListId = (state as DetailState | undefined)?.smartListId ?? null;
    await super.setState(state, result);
    this.ensureChrome();
    await this.refresh();
  }

  async onOpen(): Promise<void> {
    this.ensureChrome();
    await this.refresh();
  }

  /** Idempotent — `onOpen`/`setState` can fire in either order depending on how the
   * leaf was created, so this only builds the persistent live-region/content-area
   * chrome once, whichever runs first. */
  private ensureChrome(): void {
    if (this.contentAreaEl !== null) return;
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("perlite-list-view");
    const liveRegion = root.createDiv({ cls: "perlite-visually-hidden", attr: { "aria-live": "polite" } });
    this.contentAreaEl = root.createDiv();
    this.keyboardNav.attach(this.contentAreaEl, liveRegion);
  }

  async refresh(): Promise<void> {
    this.ensureChrome();
    const container = this.contentAreaEl;
    if (container === null) return;
    container.empty();

    const list = mergeSmartListCatalog(this.plugin.smartLists).find((l) => l.id === this.smartListId);
    if (list === undefined) {
      container.createDiv({ cls: "perlite-empty-state", text: "This smart list no longer exists." });
      this.keyboardNav.setRows([]);
      return;
    }

    const configuration = parserConfiguration(this.plugin.settings);
    const { located } = await scanVaultTasks(this.app, this.plugin.settings.excludedFolders, configuration);
    const byTask = new Map(located.map((entry) => [entry.task, entry] as const));

    const results = SmartListEngine.evaluate(
      located.map((entry) => entry.task),
      [list],
      todayCalendarDate(),
    );
    const tasks = results[0]?.tasks ?? [];

    if (tasks.length === 0) {
      container.createDiv({ cls: "perlite-empty-state", text: "No tasks in this list." });
      this.keyboardNav.setRows([]);
      return;
    }

    const findEntry = (task: (typeof tasks)[number]): LocatedTask | undefined => byTask.get(task);
    const navRows: KeyboardNavRow[] = [];

    if (list.grouping === null) {
      const listEl = container.createDiv({ cls: "perlite-segment__list" });
      for (const task of tasks) {
        const entry = findEntry(task);
        if (entry !== undefined) navRows.push(this.renderRow(listEl, task, entry));
      }
      this.keyboardNav.setRows(navRows);
      return;
    }

    const groups: TaskGroup[] = group(tasks, list.grouping);
    for (const taskGroup of groups) {
      const section = container.createDiv({ cls: "perlite-segment" });
      section.createEl("h6", { cls: "perlite-segment__title", text: `${taskGroup.key} (${taskGroup.tasks.length})` });
      const listEl = section.createDiv({ cls: "perlite-segment__list" });
      for (const task of taskGroup.tasks) {
        const entry = findEntry(task);
        if (entry !== undefined) navRows.push(this.renderRow(listEl, task, entry));
      }
    }
    this.keyboardNav.setRows(navRows);
  }

  private renderRow(container: HTMLElement, task: LocatedTask["task"], entry: LocatedTask): KeyboardNavRow {
    const rowEl = renderInteractiveTaskRow(container, this.app, this.plugin, task, entry.file, this.leaf, () => this.refresh());
    return { task, file: entry.file, rowEl };
  }
}
