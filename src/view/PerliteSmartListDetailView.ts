import { ItemView, Notice, WorkspaceLeaf, type ViewStateResult } from "obsidian";
import { renderEmptyState } from "../design/renderEmptyState.js";
import { renderSectionHeader } from "../design/renderSectionHeader.js";
import { group, type TaskGroup } from "../query/GroupingEngine.js";
import { mergeSmartListCatalog } from "../query/smartListCatalog.js";
import * as SmartListEngine from "../query/SmartListEngine.js";
import { withUpdatedList } from "../query/smartListMutations.js";
import { parserConfiguration } from "../settings.js";
import { todayCalendarDate } from "../support/today.js";
import { scanVaultTasks, type LocatedTask } from "../vaultTaskScan.js";
import { SmartListEditorModal } from "../SmartListEditorModal.js";
import { renderCalendarBoard, type CalendarBoardState } from "./CalendarBoard.js";
import { renderKanbanBoard } from "./KanbanBoard.js";
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
  /** The calendar lens's own month/day navigation position — persisted here (not inside
   * `CalendarBoard.ts`) so a pure nav click or a write-triggered `refresh()` doesn't
   * reset the view back to today's month. Lazily initialised to "today" the first time a
   * calendar-lens list is actually opened; a `list.lens !== "calendar"` refresh never
   * touches it. */
  private calendarState: CalendarBoardState | null = null;

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

    // Both actions read `this.smartListId`/`this.plugin.smartLists` at click time, not
    // at `ensureChrome`'s one-time call time — this same leaf can be re-pointed at a
    // different smart list later via `setState`, and `ensureChrome`'s own idempotency
    // guard above means this is the only place these buttons ever get created.
    this.addAction("arrow-left", "Back to smart lists", () => {
      void this.plugin.activateSmartListsView();
    });
    this.addAction("pencil", "Edit this list", () => {
      const list = mergeSmartListCatalog(this.plugin.smartLists).find((l) => l.id === this.smartListId);
      if (list === undefined) return;
      if (list.isBuiltIn) {
        new Notice('Built-in lists can\'t be edited — use "Hide" from the Smart Lists hub instead.');
        return;
      }
      new SmartListEditorModal(this.app, list, (updated) => {
        void this.plugin.mutateSmartLists((stored) => withUpdatedList(stored, updated));
      }).open();
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

    const list = mergeSmartListCatalog(this.plugin.smartLists).find((l) => l.id === this.smartListId);
    if (list === undefined) {
      renderEmptyState(container, { icon: "circle-x", title: "This smart list no longer exists." });
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
    const findEntry = (task: (typeof tasks)[number]): LocatedTask | undefined => byTask.get(task);
    const listLocated: LocatedTask[] = tasks.map(findEntry).filter((entry): entry is LocatedTask => entry !== undefined);

    // Kanban/calendar must render their frame (columns / the month grid) even with zero
    // matching tasks — a status/priority column, or a day cell, is still a valid drop
    // target with nothing in it, same reasoning as `KanbanBoard.expandColumns`'s own doc
    // comment. This check has to come before the "no tasks" early-return just below, not
    // after it: an empty kanban/calendar list used to fall into that return and render
    // the flat-list empty-state text instead of its board, making a genuinely working
    // kanban/calendar list indistinguishable from a broken one.
    if (list.lens === "kanban") {
      renderKanbanBoard(container, {
        app: this.app,
        plugin: this.plugin,
        list,
        located: listLocated,
        hoverParent: this.leaf,
        onAfterWrite: () => this.refresh(),
      });
      // A 2D column/row board doesn't fit `ListKeyboardNav`'s flat row model — no
      // keyboard nav inside the board in this first cut, mouse/touch drag + click-to-
      // open/complete still work. See the plan's own "Known scope cuts."
      this.keyboardNav.setRows([]);
      return;
    }

    if (list.lens === "calendar") {
      this.calendarState ??= (() => {
        const today = todayCalendarDate();
        return { visibleMonth: { ...today, day: 1 }, selectedDate: today };
      })();
      renderCalendarBoard(container, {
        app: this.app,
        plugin: this.plugin,
        list,
        located: listLocated,
        hoverParent: this.leaf,
        initialState: this.calendarState,
        onStateChange: (next) => {
          this.calendarState = next;
        },
        onRowsChanged: (rows) => this.keyboardNav.setRows([...rows]),
        onAfterWrite: () => this.refresh(),
      });
      return;
    }

    // The flat "list" lens, unlike kanban/calendar above, has no frame worth showing
    // empty — just the message.
    if (tasks.length === 0) {
      renderEmptyState(container, { icon: list.icon, title: "No tasks in this list." });
      this.keyboardNav.setRows([]);
      return;
    }

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
      renderSectionHeader(section, { icon: list.icon, title: taskGroup.key, count: taskGroup.tasks.length });
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
