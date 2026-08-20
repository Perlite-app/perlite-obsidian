import { ItemView, WorkspaceLeaf, type ViewStateResult } from "obsidian";
import { group, type TaskGroup } from "../query/GroupingEngine.js";
import { mergeSmartListCatalog } from "../query/smartListCatalog.js";
import * as SmartListEngine from "../query/SmartListEngine.js";
import { parserConfiguration } from "../settings.js";
import { todayCalendarDate } from "../support/today.js";
import { scanVaultTasks, type LocatedTask } from "../vaultTaskScan.js";
import { renderInteractiveTaskRow } from "./taskRowInteractions.js";
import type PerlitePlugin from "../main.js";

/**
 * One smart list's evaluated contents — reached by tapping a row in
 * `PerliteSmartListsView`. Applies the list's own `grouping`/`sorting` exactly as
 * `SmartListEngine.evaluate` + `GroupingEngine.group` already compute them; this view
 * adds no filtering/sorting logic of its own.
 */
export const PERLITE_SMART_LIST_DETAIL_VIEW_TYPE = "perlite-smart-list-detail-view";

interface DetailState {
  readonly smartListId?: string;
}

export class PerliteSmartListDetailView extends ItemView {
  private readonly plugin: PerlitePlugin;
  private smartListId: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PerlitePlugin) {
    super(leaf);
    this.plugin = plugin;
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
    await this.refresh();
  }

  async onOpen(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("perlite-list-view");

    const list = mergeSmartListCatalog(this.plugin.smartLists).find((l) => l.id === this.smartListId);
    if (list === undefined) {
      container.createDiv({ cls: "perlite-empty-state", text: "This smart list no longer exists." });
      return;
    }

    const configuration = parserConfiguration(this.plugin.settings);
    const { located } = await scanVaultTasks(this.app, this.plugin.settings.excludedFolders, configuration);
    const byRaw = new Map(located.map((entry) => [entry.task, entry] as const));

    const results = SmartListEngine.evaluate(
      located.map((entry) => entry.task),
      [list],
      todayCalendarDate(),
    );
    const tasks = results[0]?.tasks ?? [];

    if (tasks.length === 0) {
      container.createDiv({ cls: "perlite-empty-state", text: "No tasks in this list." });
      return;
    }

    const findEntry = (task: (typeof tasks)[number]): LocatedTask | undefined => byRaw.get(task);

    if (list.grouping === null) {
      const listEl = container.createDiv({ cls: "perlite-segment__list" });
      for (const task of tasks) {
        const entry = findEntry(task);
        if (entry !== undefined) renderInteractiveTaskRow(listEl, this.app, this.plugin, task, entry.file, () => this.refresh());
      }
      return;
    }

    const groups: TaskGroup[] = group(tasks, list.grouping);
    for (const taskGroup of groups) {
      const section = container.createDiv({ cls: "perlite-segment" });
      section.createEl("h6", { cls: "perlite-segment__title", text: `${taskGroup.key} (${taskGroup.tasks.length})` });
      const listEl = section.createDiv({ cls: "perlite-segment__list" });
      for (const task of taskGroup.tasks) {
        const entry = findEntry(task);
        if (entry !== undefined) renderInteractiveTaskRow(listEl, this.app, this.plugin, task, entry.file, () => this.refresh());
      }
    }
  }
}
