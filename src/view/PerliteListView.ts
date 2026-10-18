import { ItemView, Menu, setIcon, type WorkspaceLeaf } from "obsidian";
import { appendQuickAddTask } from "../write/appendQuickAddTask.js";
import { buildQuickAddTaskLine } from "../capture/QuickAddParser.js";
import { longDayLabel, relativeDayLabel } from "../design/relativeDay.js";
import { renderEmptyState } from "../design/renderEmptyState.js";
import { dateValueCalendarDate } from "../model/DateValue.js";
import {
  groupForList,
  isOpen,
  isOverdue,
  lensCaptureDefaults,
  lensMatches,
  lensTitle,
  priorityTitle,
  splitNotePath,
  upNext,
  type ListGrouping,
} from "../query/lenses.js";
import { isCompletedToday } from "../query/completedToday.js";
import { parserConfiguration, type PerliteMode } from "../settings.js";
import { todayCalendarDate } from "../support/today.js";
import type { LocatedTask } from "../vaultTaskScan.js";
import { renderBoardMode } from "./main/boardMode.js";
import { renderCalendarMode } from "./main/calendarMode.js";
import { parseWithDefaults, previewLine, renderCaptureField, type CaptureField } from "./main/captureField.js";
import { Toast } from "./main/toast.js";
import { renderTaskRow, titleWithoutTags } from "./main/taskRow.js";
import { ListKeyboardNav, type KeyboardNavRow } from "./ListKeyboardNav.js";
import { completeTaskAndWrite } from "./taskRowInteractions.js";
import { openTaskNote } from "./taskWrites.js";
import type PerlitePlugin from "../main.js";

/**
 * The main Perlite tab (design pass, "Plugin · List / Board / Calendar"): one `ItemView`
 * showing the lens picked in the "Perlite lenses" sidebar, in one of three modes. The
 * tab title is the lens (`getDisplayText`); New task and the ⋯ menu are view actions.
 *
 * - **List** — progress ring and date, a capture field that writes into the lens it's
 *   typed on, an Up next card, then the tasks grouped by note, due day or priority.
 *   Click a row to show it in the Task sidebar; double-click (or Enter) to open the
 *   note at its line. Keyboard triage (`ListKeyboardNav`) works as before.
 * - **Board** and **Calendar** — `main/boardMode.ts`, `main/calendarMode.ts`. No title
 *   block: one toolbar row (with the layout switch) and the rest of the pane for the
 *   columns or the grid, which fill its height and scroll inside.
 *
 * Keeps the original view type id so a saved workspace still opens it.
 */
export const PERLITE_LIST_VIEW_TYPE = "perlite-list-view";

const MODES: readonly { readonly mode: PerliteMode; readonly label: string; readonly icon: string }[] = [
  { mode: "list", label: "List", icon: "list" },
  { mode: "board", label: "Board", icon: "kanban" },
  { mode: "calendar", label: "Calendar", icon: "calendar-days" },
];

const GROUPINGS: readonly { readonly grouping: ListGrouping; readonly label: string }[] = [
  { grouping: "note", label: "Note" },
  { grouping: "due", label: "Due" },
  { grouping: "priority", label: "Priority" },
];

export class PerliteListView extends ItemView {
  private readonly plugin: PerlitePlugin;
  readonly keyboardNav: ListKeyboardNav;
  private bodyEl: HTMLElement | null = null;
  private toast: Toast | null = null;
  /** The inline capture's text, kept across re-renders (a rescan rebuilds the DOM). */
  private draft = "";
  private capture: CaptureField | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PerlitePlugin) {
    super(leaf);
    this.plugin = plugin;
    this.keyboardNav = new ListKeyboardNav(this, this.app, plugin, () => plugin.refreshAllViews());
    this.keyboardNav.onSelectionChange = (row) => {
      const entry = row === null ? null : (this.plugin.state.located.find((candidate) => candidate.task === row.task) ?? null);
      this.plugin.state.select(entry);
    };
  }

  getViewType(): string {
    return PERLITE_LIST_VIEW_TYPE;
  }

  getDisplayText(): string {
    const state = this.plugin.state;
    return lensTitle(state.lens, state.smartLists);
  }

  getIcon(): string {
    return "circle-check";
  }

  async onOpen(): Promise<void> {
    this.addAction("more-horizontal", "More options", (event) => this.showMoreMenu(event));
    this.addAction("plus", "New task", () => this.plugin.openQuickAdd());

    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("perlite-main");
    const liveRegion = root.createDiv({ cls: "perlite-visually-hidden", attr: { "aria-live": "polite" } });
    this.bodyEl = root.createDiv({ cls: "perlite-main__body" });
    // On the view's own container, which doesn't scroll — the content area does.
    this.containerEl.addClass("perlite-toast-host");
    this.toast = new Toast(this.containerEl);
    this.keyboardNav.attach(this.bodyEl, liveRegion);

    const state = this.plugin.state;
    this.registerEvent(state.on("data", () => this.render()));
    this.registerEvent(state.on("view", () => this.render()));
    this.registerEvent(state.on("selection", () => this.paintSelection()));
    if (state.hasScanned) this.render();
    else await state.rescan();
  }

  async onClose(): Promise<void> {
    this.toast?.dismiss();
  }

  /** Called by `PerlitePlugin.refreshAllViews` — the shared state rescans once for
   * every Perlite surface. */
  async refresh(): Promise<void> {
    await this.plugin.state.rescan();
  }

  private showMoreMenu(event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Show lenses sidebar").setIcon("panel-left").onClick(() => void this.plugin.revealLensesSidebar()));
    menu.addItem((item) => item.setTitle("Show task sidebar").setIcon("panel-right").onClick(() => void this.plugin.revealTaskSidebar()));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Manage smart lists").setIcon("layout-list").onClick(() => void this.plugin.activateSmartListsView()));
    menu.addItem((item) => item.setTitle("Rescan vault").setIcon("refresh-cw").onClick(() => void this.plugin.refreshAllViews()));
    menu.showAtMouseEvent(event);
  }

  private lensTasks(): LocatedTask[] {
    const state = this.plugin.state;
    const today = todayCalendarDate();
    const lists = state.smartLists;
    return state.located.filter((entry) => lensMatches(entry.task, state.lens, today, lists));
  }

  private render(): void {
    const body = this.bodyEl;
    if (body === null) return;
    // The tab title follows the lens.
    (this.leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.();
    // A rescan (a vault change, often the write the user just made) rebuilds everything;
    // keep the user's place — the capture field's focus and caret, and the scroll.
    const input = this.capture?.inputEl ?? null;
    const typing = input !== null && document.activeElement === input ? { start: input.selectionStart, end: input.selectionEnd } : null;
    const scroller = this.containerEl.children[1] as HTMLElement;
    const scrollTop = scroller.scrollTop;
    body.empty();
    this.capture = null;
    try {
      this.renderMode(body);
    } finally {
      scroller.scrollTop = scrollTop;
      if (typing !== null && this.capture !== null) {
        const field: CaptureField = this.capture;
        field.inputEl.focus();
        field.inputEl.setSelectionRange(typing.start, typing.end);
      }
    }
  }

  private renderMode(body: HTMLElement): void {
    const state = this.plugin.state;
    const view = state.view;
    const tasks = this.lensTasks();
    const scroller = this.containerEl.children[1] as HTMLElement;
    // Board and calendar fill the pane and scroll inside their columns/days; the list
    // scrolls the pane itself.
    scroller.toggleClass("is-fill", view.mode !== "list");
    body.dataset.mode = view.mode;

    if (view.mode === "list") this.renderHeader(body, tasks);

    if (state.conflictPaths.length > 0) {
      const count = state.conflictPaths.length;
      body.createDiv({
        cls: "perlite-banner",
        text: `${count === 1 ? "1 sync-conflict file was" : `${count} sync-conflict files were`} found and left out — resolve ${count === 1 ? "it" : "them"} in your sync client.`,
      });
    }

    const after = async (): Promise<void> => {
      await this.plugin.refreshAllViews();
    };

    const layoutSwitch = (container: HTMLElement): void => this.renderLayoutSwitch(container);
    if (view.mode === "board") {
      this.keyboardNav.setRows([]);
      renderBoardMode(body, { plugin: this.plugin, view: this, tasks, toast: this.toast!, afterWrite: after, layoutSwitch });
      return;
    }
    if (view.mode === "calendar") {
      this.keyboardNav.setRows([]);
      renderCalendarMode(body, { plugin: this.plugin, view: this, tasks, toast: this.toast!, afterWrite: after, layoutSwitch });
      return;
    }
    this.renderList(body, tasks);
  }

  // --- Header -------------------------------------------------------------------------

  private renderHeader(body: HTMLElement, tasks: readonly LocatedTask[]): void {
    const state = this.plugin.state;
    const today = todayCalendarDate();
    const done = tasks.filter((entry) => entry.task.status.kind === "done").length;
    const header = body.createDiv({ cls: "perlite-header" });

    const ring = header.createDiv({ cls: "perlite-progress", attr: { role: "img", "aria-label": `${done} of ${tasks.length} tasks done` } });
    const fraction = tasks.length === 0 ? 0 : done / tasks.length;
    ring.style.setProperty("--perlite-progress", String(fraction));

    const titles = header.createDiv({ cls: "perlite-header__titles" });
    titles.createDiv({ cls: "perlite-header__title", text: lensTitle(state.lens, state.smartLists) });
    titles.createDiv({ cls: "perlite-header__subtitle", text: `${longDayLabel(today)} · ${done} of ${tasks.length} done` });

    this.renderLayoutSwitch(header);
  }

  /** List / Board / Calendar — in the list's header, and at the end of the board's and
   * calendar's toolbar. */
  private renderLayoutSwitch(container: HTMLElement): void {
    const state = this.plugin.state;
    const switcher = container.createDiv({ cls: "perlite-segmented perlite-layout-switch", attr: { role: "radiogroup", "aria-label": "Layout" } });
    for (const option of MODES) {
      const button = switcher.createEl("button", {
        cls: "perlite-segmented__option",
        attr: { type: "button", role: "radio", "aria-checked": String(state.view.mode === option.mode) },
      });
      setIcon(button.createSpan({ cls: "perlite-segmented__icon" }), option.icon);
      button.createSpan({ text: option.label });
      button.addEventListener("click", () => state.updateView({ mode: option.mode }));
    }
  }

  // --- List mode ------------------------------------------------------------------------

  private renderList(body: HTMLElement, tasks: readonly LocatedTask[]): void {
    const state = this.plugin.state;
    const today = todayCalendarDate();
    this.renderCapture(body);

    const focus = upNext(tasks.map((entry) => entry.task), today);
    const focusEntry = focus === null ? null : (tasks.find((entry) => entry.task === focus) ?? null);
    if (focusEntry !== null) this.renderUpNext(body, focusEntry);

    const openCount = tasks.filter((entry) => isOpen(entry.task)).length;
    const toolbar = body.createDiv({ cls: "perlite-toolbar" });
    toolbar.createSpan({ cls: "perlite-toolbar__count", text: `${openCount} open` });
    const groupBy = toolbar.createDiv({ cls: "perlite-chips", attr: { role: "radiogroup", "aria-label": "Group by" } });
    groupBy.createSpan({ cls: "perlite-chips__label", text: "Group by" });
    for (const option of GROUPINGS) {
      const chip = groupBy.createEl("button", {
        cls: "perlite-chips__chip",
        text: option.label,
        attr: { type: "button", role: "radio", "aria-checked": String(state.view.grouping === option.grouping) },
      });
      chip.addEventListener("click", () => state.updateView({ grouping: option.grouping }));
    }

    const listEl = body.createDiv({ cls: "perlite-groups" });
    const navRows: KeyboardNavRow[] = [];
    if (tasks.length === 0) {
      renderEmptyState(listEl, {
        icon: "circle-check",
        title: state.lens.kind === "today" ? "All caught up." : "Nothing here.",
        hint: "Type a task above, or press New task.",
      });
      this.keyboardNav.setRows([]);
      return;
    }

    const byTask = new Map(tasks.map((entry) => [entry.task, entry] as const));
    for (const group of groupForList(tasks.map((entry) => entry.task), state.view.grouping, today)) {
      const section = listEl.createDiv({ cls: "perlite-group" });
      const head = section.createDiv({ cls: "perlite-group__head" });
      head.dataset.tone = group.tone;
      setIcon(head.createSpan({ cls: "perlite-group__icon" }), state.view.grouping === "note" ? "file" : state.view.grouping === "priority" ? "flag" : "calendar");
      const name = head.createSpan({ cls: "perlite-group__name" });
      if (group.prefix.length > 0) name.createSpan({ cls: "perlite-group__prefix", text: group.prefix });
      name.appendText(group.title);
      head.createSpan({ cls: "perlite-group__count", text: String(group.tasks.filter(isOpen).length) });

      for (const task of group.tasks) {
        const entry = byTask.get(task);
        if (entry === undefined) continue;
        const rowEl = renderTaskRow(section, {
          entry,
          today,
          showNote: state.view.grouping !== "note",
          selected: state.isSelected(entry),
          onComplete: (e) => void this.complete(e),
          onSelect: (e, el) => {
            this.keyboardNav.selectRow(el);
            state.select(e);
          },
          onOpen: (e) => void openTaskNote(this.app, e, "tab"),
          hover: { app: this.app, parent: this.leaf },
        });
        rowEl.dataset.key = `${entry.file.path}:${entry.task.location?.lineIndex ?? -1}`;
        navRows.push({ task: entry.task, file: entry.file, rowEl });
      }
    }
    this.keyboardNav.setRows(navRows);
  }

  private async complete(entry: LocatedTask): Promise<void> {
    await completeTaskAndWrite(this.app, this.plugin, entry.task, entry.file);
    await this.plugin.refreshAllViews();
  }

  /** Selection changes repaint only the row highlight — no rebuild, so focus and the
   * capture draft stay put. */
  private paintSelection(): void {
    const body = this.bodyEl;
    if (body === null) return;
    const selected = this.plugin.state.selected;
    const key = selected === null ? null : `${selected.file.path}:${selected.task.location?.lineIndex ?? -1}`;
    body.querySelectorAll<HTMLElement>(".perlite-row[data-key]").forEach((row) => row.toggleClass("is-selected", row.dataset.key === key));
  }

  /** The inline capture: type a task in plain words, Enter writes it into the lens it was
   * typed on (Today → due today, a tag → that tag, a note → that note). */
  private renderCapture(body: HTMLElement): void {
    const state = this.plugin.state;
    const lens = state.lens;
    const defaults = lensCaptureDefaults(lens);
    const destination = defaults.destination ?? this.plugin.settings.defaultInboxFile;

    const box = body.createDiv({ cls: "perlite-capture-box" });
    const rowEl = box.createDiv({ cls: "perlite-capture-box__row" });
    setIcon(rowEl.createSpan({ cls: "perlite-capture-box__icon" }), "circle-plus");
    const preview = box.createDiv({ cls: "perlite-capture-box__preview" });

    const paintPreview = (): void => {
      preview.empty();
      const line = previewLine(parseWithDefaults(this.draft, defaults, todayCalendarDate()), this.plugin.settings, todayCalendarDate());
      preview.toggleClass("is-empty", line === null);
      if (line === null) return;
      preview.createSpan({ cls: "perlite-capture-box__dest", text: destination });
      preview.createEl("code", { cls: "perlite-capture-box__md", text: line });
    };

    this.capture = renderCaptureField(rowEl, {
      placeholder: `Add a task — “tomorrow !! #work”`,
      label: "Add a task",
      initial: this.draft,
      onChange: (value) => {
        this.draft = value;
        paintPreview();
      },
      onKeyDown: (event) => {
        if (event.key === "Enter" && !event.isComposing) {
          event.preventDefault();
          void this.submitCapture(destination);
        }
      },
    });
    rowEl.createSpan({ cls: "perlite-capture-box__hint", text: "↵ to add" });
    paintPreview();
  }

  private async submitCapture(destination: string): Promise<void> {
    if (this.draft.trim().length === 0) return;
    const today = todayCalendarDate();
    const result = parseWithDefaults(this.draft, lensCaptureDefaults(this.plugin.state.lens), today);
    if (result.description.trim().length === 0) return;
    const task = buildQuickAddTaskLine(result, today, parserConfiguration(this.plugin.settings));
    const added = await appendQuickAddTask(this.app, task, destination);
    if (!added) return;
    this.draft = "";
    await this.plugin.refreshAllViews();
    this.capture?.focus();
  }

  private renderUpNext(body: HTMLElement, entry: LocatedTask): void {
    const today = todayCalendarDate();
    const task = entry.task;
    const card = body.createDiv({ cls: "perlite-upnext" });
    const text = card.createDiv({ cls: "perlite-upnext__text" });
    const eyebrow = text.createDiv({ cls: "perlite-upnext__eyebrow" });
    eyebrow.appendText("Up next · ");
    const due = dateValueCalendarDate(task.due);
    const when = eyebrow.createSpan({
      text: due !== null ? (isOverdue(task, today) ? `Overdue · ${relativeDayLabel(due, today).toLowerCase()}` : `Due ${relativeDayLabel(due, today).toLowerCase()}`) : priorityTitle(task.priority),
    });
    when.toggleClass("is-overdue", isOverdue(task, today));
    text.createDiv({ cls: "perlite-upnext__title", text: titleWithoutTags(task) });
    const { folder, note } = splitNotePath(entry.file.path);
    text.createDiv({ cls: "perlite-upnext__crumb", text: `${folder}${note} · line ${(task.location?.lineIndex ?? 0) + 1}` });

    const actions = card.createDiv({ cls: "perlite-upnext__actions" });
    const details = actions.createEl("button", { cls: "perlite-button perlite-button--ghost", text: "Details", attr: { type: "button" } });
    details.addEventListener("click", () => {
      this.plugin.state.select(entry);
      void this.plugin.revealTaskSidebar();
    });
    const done = actions.createEl("button", { cls: "perlite-button mod-cta", attr: { type: "button", "aria-label": `Done: ${titleWithoutTags(task)}` } });
    setIcon(done.createSpan(), "check");
    done.appendText("Done");
    done.addEventListener("click", () => void this.complete(entry));
  }
}

/** Open tasks due or overdue today, plus those finished today — the status bar's count
 * and the ring's denominator on the Today lens. */
export function todayCounts(located: readonly LocatedTask[]): { readonly open: number; readonly done: number } {
  const today = todayCalendarDate();
  let open = 0;
  let done = 0;
  for (const entry of located) {
    if (isOpen(entry.task) && lensMatches(entry.task, { kind: "today" }, today, [])) open += 1;
    else if (isCompletedToday(entry.task, today)) done += 1;
  }
  return { open, done };
}
