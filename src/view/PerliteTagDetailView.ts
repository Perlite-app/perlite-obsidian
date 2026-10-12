import { ItemView, WorkspaceLeaf, type ViewStateResult } from "obsidian";
import { renderEmptyState } from "../design/renderEmptyState.js";
import { renderSectionHeader } from "../design/renderSectionHeader.js";
import * as FilterEngine from "../query/FilterEngine.js";
import { sortCriterion, type SortCriterion } from "../query/SortCriterion.js";
import * as SortEngine from "../query/SortEngine.js";
import { parserConfiguration } from "../settings.js";
import { todayCalendarDate } from "../support/today.js";
import { scanVaultTasks, type LocatedTask } from "../vaultTaskScan.js";
import { ListKeyboardNav, type KeyboardNavRow } from "./ListKeyboardNav.js";
import { renderInteractiveTaskRow } from "./taskRowInteractions.js";
import type PerlitePlugin from "../main.js";

/**
 * Every task carrying one tag — reached by tapping a `#tag` chip on any task row, in any
 * view (`renderInteractiveTaskRow` wires this once, so it works everywhere a row
 * renders). 1:1 port of `TagDetailView.swift`: an ad-hoc `tagExact` query re-derived
 * fresh from the vault on every `refresh()`, never a persisted `SmartList` — tapping a
 * tag is search, not list creation. Same reason there's no "save as smart list" affordance
 * here.
 *
 * Navigated to exclusively via `PerlitePlugin.activateTagDetailView` — a tag can be
 * tapped from *any* view (the standard list, any lens of any smart list), so unlike the
 * smart-list detail view's own "back to smart lists" action, there's no single sensible
 * "came from" view to return to; its own back action always targets the standard list.
 */
export const PERLITE_TAG_DETAIL_VIEW_TYPE = "perlite-tag-detail-view";

const DEFAULT_SORTING: readonly SortCriterion[] = [sortCriterion("priority"), sortCriterion("dueDate")];

interface TagDetailState {
  readonly tag?: string;
}

export class PerliteTagDetailView extends ItemView {
  private readonly plugin: PerlitePlugin;
  readonly keyboardNav: ListKeyboardNav;
  private tag: string | null = null;
  private contentAreaEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PerlitePlugin) {
    super(leaf);
    this.plugin = plugin;
    this.keyboardNav = new ListKeyboardNav(this, this.app, plugin, () => this.refresh());
  }

  getViewType(): string {
    return PERLITE_TAG_DETAIL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.tag ?? "Tag";
  }

  getIcon(): string {
    return "tags";
  }

  getState(): Record<string, unknown> {
    return { tag: this.tag ?? undefined };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    this.tag = (state as TagDetailState | undefined)?.tag ?? null;
    await super.setState(state, result);
    this.ensureChrome();
    await this.refresh();
  }

  async onOpen(): Promise<void> {
    this.ensureChrome();
    await this.refresh();
  }

  private ensureChrome(): void {
    if (this.contentAreaEl !== null) return;

    this.addAction("arrow-left", "Back to task list", () => {
      void this.plugin.activateListView();
    });

    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("perlite-list-view");
    const liveRegion = root.createDiv({ cls: "perlite-visually-hidden", attr: { "aria-live": "polite" } });
    this.contentAreaEl = root.createDiv({ cls: "perlite-detail-view-content" });
    this.keyboardNav.attach(this.contentAreaEl, liveRegion);
  }

  async refresh(): Promise<void> {
    this.ensureChrome();
    const container = this.contentAreaEl;
    if (container === null) return;
    container.empty();

    if (this.tag === null) {
      renderEmptyState(container, { icon: "tags", title: "No tag selected." });
      this.keyboardNav.setRows([]);
      return;
    }

    const configuration = parserConfiguration(this.plugin.settings);
    const { located } = await scanVaultTasks(this.app, this.plugin.settings.excludedFolders, configuration);
    const byTask = new Map(located.map((entry) => [entry.task, entry] as const));

    const matched = FilterEngine.apply(
      located.map((entry) => entry.task),
      { type: "criterion", criterion: { type: "tagExact", tag: this.tag } },
      todayCalendarDate(),
    );
    const tasks = SortEngine.sort(matched, DEFAULT_SORTING);

    if (tasks.length === 0) {
      renderEmptyState(container, { icon: "tags", title: "No tasks currently carry this tag." });
      this.keyboardNav.setRows([]);
      return;
    }

    renderSectionHeader(container, { icon: "tags", title: this.tag, count: tasks.length, accentClass: "perlite-tag-accent" });

    const navRows: KeyboardNavRow[] = [];
    const listEl = container.createDiv({ cls: "perlite-segment__list" });
    for (const task of tasks) {
      const entry = byTask.get(task);
      if (entry !== undefined) navRows.push(this.renderRow(listEl, entry));
    }
    this.keyboardNav.setRows(navRows);
  }

  private renderRow(container: HTMLElement, entry: LocatedTask): KeyboardNavRow {
    const rowEl = renderInteractiveTaskRow(container, this.app, this.plugin, entry.task, entry.file, this.leaf, () => this.refresh());
    return { task: entry.task, file: entry.file, rowEl };
  }
}
