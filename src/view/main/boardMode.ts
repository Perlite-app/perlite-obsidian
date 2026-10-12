import { Menu, Platform, setIcon, type ItemView } from "obsidian";
import { relativeDayLabel } from "../../design/relativeDay.js";
import { dateValueCalendarDate } from "../../model/DateValue.js";
import { PRIORITY_VALUES, priorityMarker, type Priority } from "../../model/Priority.js";
import * as TaskSerializer from "../../parser/TaskSerializer.js";
import { compareForAttention, isOpen, isOverdue, lensMatches, priorityTitle, splitNotePath } from "../../query/lenses.js";
import { parserConfiguration, type BoardColumns } from "../../settings.js";
import { todayCalendarDate } from "../../support/today.js";
import type { LocatedTask } from "../../vaultTaskScan.js";
import { copyTaskLine, editWithUndo, openTaskNote, setStatusChoice, statusChoiceOf, type StatusChoice, type Undo } from "../taskWrites.js";
import type { Toast } from "./toast.js";
import { renderStatusRing, titleWithoutTags } from "./taskRow.js";
import type PerlitePlugin from "../../main.js";

/**
 * Board mode (design pass, "Plugin · Board"): the lens's tasks as cards in columns by
 * Status, Priority or Note. Move a card by dragging it (HTML5 drag and drop, desktop) or
 * with its ⋯ menu's "Move to" — the menu is the path on mobile Obsidian (no touch drag)
 * and for keyboard users. Each move is one `vault.process` write, shown in a toast with
 * Undo. Clicking a card's title opens its note beside the board, at the line.
 *
 * Note columns are view-only: moving a line between notes is two writes (remove here,
 * append there) and isn't built yet — status and priority ship first, as planned.
 */

export interface BoardModeOptions {
  readonly plugin: PerlitePlugin;
  readonly view: ItemView;
  readonly tasks: readonly LocatedTask[];
  readonly toast: Toast;
  readonly afterWrite: () => Promise<void>;
}

interface Column {
  readonly key: string;
  readonly name: string;
  readonly badge: string;
  readonly icon: string;
  readonly tone: string;
  readonly entries: readonly LocatedTask[];
  /** `null` for view-only (note) columns. */
  readonly accept: ((entry: LocatedTask) => Promise<Undo | null>) | null;
  readonly describeWrite: (entry: LocatedTask) => string;
}

const STATUS_COLUMNS: readonly { readonly choice: StatusChoice; readonly name: string; readonly badge: string; readonly icon: string }[] = [
  { choice: "todo", name: "To do", badge: "[ ]", icon: "circle" },
  { choice: "doing", name: "In progress", badge: "[/]", icon: "circle-dot" },
  { choice: "done", name: "Done", badge: "[x]", icon: "circle-check" },
  { choice: "cancelled", name: "Cancelled", badge: "[-]", icon: "circle-slash" },
];

const STATUS_SYMBOL: Readonly<Record<StatusChoice, string>> = { todo: " ", doing: "/", done: "x", cancelled: "-" };

/** Which columns are folded — per session; Cancelled starts folded. */
const collapsed = new Set<string>(["cancelled"]);

export function renderBoardMode(body: HTMLElement, options: BoardModeOptions): void {
  const { plugin } = options;
  const state = plugin.state;
  const today = todayCalendarDate();
  const columnsBy = state.view.boardColumns;
  // The board shows cancelled tasks too (its own column), where the lens allows.
  const entries = state.located
    .filter((entry) => lensMatches(entry.task, state.lens, today, state.smartLists, { includeCancelled: true }))
    .sort((a, b) => compareForAttention(a.task, b.task, today));

  const openCount = entries.filter((entry) => isOpen(entry.task)).length;
  const doing = entries.filter((entry) => statusChoiceOf(entry.task) === "doing").length;
  const toolbar = body.createDiv({ cls: "perlite-toolbar" });
  toolbar.createSpan({
    cls: "perlite-toolbar__count",
    text: `${openCount} open · ${doing} in progress · ${Platform.isMobile ? "use ⋯ to move" : "drag, or use ⋯ to move"}`,
  });
  const picker = toolbar.createDiv({ cls: "perlite-chips", attr: { role: "radiogroup", "aria-label": "Columns" } });
  picker.createSpan({ cls: "perlite-chips__label", text: "Columns" });
  for (const [value, label] of [
    ["status", "Status"],
    ["priority", "Priority"],
    ["note", "Note"],
  ] as const) {
    const chip = picker.createEl("button", {
      cls: "perlite-chips__chip",
      text: label,
      attr: { type: "button", role: "radio", "aria-checked": String(columnsBy === value) },
    });
    chip.addEventListener("click", () => state.updateView({ boardColumns: value as BoardColumns }));
  }

  const columns = buildColumns(columnsBy, entries, options);
  const board = body.createDiv({ cls: "perlite-board" });
  let dragged: LocatedTask | null = null;

  const move = async (entry: LocatedTask, column: Column): Promise<void> => {
    if (column.accept === null) return;
    const headline = column.describeWrite(entry);
    const undo = await column.accept(entry);
    await options.afterWrite();
    options.toast.show(headline, { undo, onUndone: () => void options.afterWrite() });
  };

  for (const column of columns) {
    const canCollapse = columnsBy === "status";
    if (canCollapse && collapsed.has(column.key)) {
      const folded = board.createEl("button", {
        cls: "perlite-board__folded",
        attr: { type: "button", "aria-label": `Expand ${column.name} column` },
      });
      setIcon(folded.createSpan(), "chevron-right");
      folded.createSpan({ cls: "perlite-board__folded-label", text: `${column.name} · ${column.entries.length}` });
      folded.addEventListener("click", () => {
        collapsed.delete(column.key);
        state.trigger("view");
      });
      attachDrop(folded, column, () => dragged, move);
      continue;
    }

    const columnEl = board.createEl("section", { cls: "perlite-column", attr: { "aria-label": column.name } });
    columnEl.dataset.tone = column.tone;
    const head = columnEl.createDiv({ cls: "perlite-column__head" });
    setIcon(head.createSpan({ cls: "perlite-column__icon" }), column.icon);
    head.createEl("h2", { cls: "perlite-column__name", text: column.name });
    head.createSpan({ cls: "perlite-column__count", text: String(column.entries.length) });
    head.createEl("code", { cls: "perlite-column__badge", text: column.badge });
    if (canCollapse && column.key === "cancelled") {
      const fold = head.createEl("button", { cls: "perlite-icon-button", attr: { type: "button", "aria-label": "Collapse column" } });
      setIcon(fold, "chevron-left");
      fold.addEventListener("click", () => {
        collapsed.add(column.key);
        state.trigger("view");
      });
    }

    const cards = columnEl.createDiv({ cls: "perlite-column__cards" });
    for (const entry of column.entries) {
      const card = renderCard(cards, entry, columns, columnsBy, options, move);
      card.addEventListener("dragstart", (event) => {
        dragged = entry;
        event.dataTransfer?.setData("text/plain", entry.task.raw);
        if (event.dataTransfer !== null) event.dataTransfer.effectAllowed = "move";
        card.addClass("is-dragging");
      });
      card.addEventListener("dragend", () => {
        dragged = null;
        card.removeClass("is-dragging");
        board.querySelectorAll(".is-drop-target").forEach((el) => el.removeClass("is-drop-target"));
      });
    }
    if (column.entries.length === 0) cards.createDiv({ cls: "perlite-column__empty", text: column.accept === null ? "—" : "Drop here" });
    attachDrop(columnEl, column, () => dragged, move);
  }
}

function attachDrop(
  el: HTMLElement,
  column: Column,
  dragged: () => LocatedTask | null,
  move: (entry: LocatedTask, column: Column) => Promise<void>,
): void {
  if (column.accept === null) return;
  el.addEventListener("dragover", (event) => {
    const entry = dragged();
    if (entry === null || column.entries.includes(entry)) return;
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
    el.addClass("is-drop-target");
  });
  el.addEventListener("dragleave", (event) => {
    if (!el.contains(event.relatedTarget as Node | null)) el.removeClass("is-drop-target");
  });
  el.addEventListener("drop", (event) => {
    event.preventDefault();
    el.removeClass("is-drop-target");
    const entry = dragged();
    if (entry !== null && !column.entries.includes(entry)) void move(entry, column);
  });
}

function where(entry: LocatedTask): string {
  return `${entry.file.path} line ${(entry.task.location?.lineIndex ?? 0) + 1}`;
}

function buildColumns(by: BoardColumns, entries: readonly LocatedTask[], options: BoardModeOptions): Column[] {
  const { plugin } = options;
  const app = plugin.app;
  const configuration = parserConfiguration(plugin.settings);
  if (by === "status") {
    return STATUS_COLUMNS.map((column) => ({
      key: column.choice,
      name: column.name,
      badge: column.badge,
      icon: column.icon,
      tone: column.choice,
      entries: entries.filter((entry) => statusChoiceOf(entry.task) === column.choice),
      accept: (entry) => setStatusChoice(app, plugin, entry, column.choice),
      describeWrite: (entry) => `Wrote [${STATUS_SYMBOL[column.choice]}] · ${where(entry)}`,
    }));
  }
  if (by === "priority") {
    const open = entries.filter((entry) => entry.task.status.kind !== "cancelled");
    return PRIORITY_VALUES.map((priority: Priority) => ({
      key: priority,
      name: priorityTitle(priority),
      badge: priorityMarker(priority) ?? "—",
      icon: "flag",
      tone: priority,
      entries: open.filter((entry) => entry.task.priority === priority),
      accept: (entry) => editWithUndo(app, entry.file, entry.task, (task) => TaskSerializer.setPriority(task, priority, configuration)),
      describeWrite: (entry) => `Set ${priorityTitle(priority).toLowerCase()} · ${where(entry)}`,
    }));
  }
  const paths = [...new Set(entries.filter((entry) => entry.task.status.kind !== "cancelled").map((entry) => entry.file.path))].sort();
  return paths.map((path) => {
    const { folder, note } = splitNotePath(path);
    return {
      key: path,
      name: note,
      badge: folder.replace(/\/$/, "") || "vault",
      icon: "file",
      tone: "normal",
      entries: entries.filter((entry) => entry.file.path === path && entry.task.status.kind !== "cancelled"),
      accept: null,
      describeWrite: () => "",
    };
  });
}

function renderCard(
  container: HTMLElement,
  entry: LocatedTask,
  columns: readonly Column[],
  columnsBy: BoardColumns,
  options: BoardModeOptions,
  move: (entry: LocatedTask, column: Column) => Promise<void>,
): HTMLElement {
  const { plugin, view } = options;
  const state = plugin.state;
  const today = todayCalendarDate();
  const task = entry.task;
  const open = isOpen(task);
  const canMove = columns.some((column) => column.accept !== null);
  const card = container.createEl("article", { cls: "perlite-card", attr: { draggable: String(canMove && !Platform.isMobile) } });
  card.toggleClass("is-done", !open);
  card.toggleClass("is-selected", state.isSelected(entry));

  const toggle = card.createEl("button", {
    cls: "perlite-row__toggle",
    attr: { type: "button", "aria-label": open ? `Complete: ${titleWithoutTags(task)}` : `Done: ${titleWithoutTags(task)}` },
  });
  renderStatusRing(toggle, task);
  toggle.disabled = !open;
  toggle.addEventListener("click", () => {
    const done = columns.find((column) => column.key === "done");
    if (done !== undefined && columnsBy === "status") void move(entry, done);
    else void setStatusChoice(plugin.app, plugin, entry, "done").then(() => options.afterWrite());
  });

  const main = card.createDiv({ cls: "perlite-card__main" });
  const title = main.createEl("button", { cls: "perlite-card__title", text: titleWithoutTags(task), attr: { type: "button" } });
  title.addEventListener("click", () => {
    state.select(entry);
    void openTaskNote(view.app, entry, "split");
  });

  const meta = main.createDiv({ cls: "perlite-row__meta" });
  const due = dateValueCalendarDate(task.due);
  if (due !== null) meta.createSpan({ cls: "perlite-pill", text: relativeDayLabel(due, today) }).toggleClass("is-overdue", isOverdue(task, today));
  if (columnsBy !== "priority" && task.priority !== "normal") {
    const pill = meta.createSpan({ cls: "perlite-pill perlite-pill--priority", text: priorityTitle(task.priority) });
    pill.dataset.priority = task.priority;
  }
  if (task.recurrenceRule !== null) setIcon(meta.createSpan({ cls: "perlite-row__icon", attr: { "aria-label": `Repeats ${task.recurrenceRule}` } }), "repeat");
  if (task.tags.length > 0) meta.createSpan({ cls: "perlite-row__tags", text: task.tags.map((tag) => tag.raw).join(" ") });
  if (meta.childElementCount === 0) meta.remove();
  main.createDiv({ cls: "perlite-card__crumb", text: `${splitNotePath(entry.file.path).note} · L${(task.location?.lineIndex ?? 0) + 1}` });

  const more = card.createEl("button", {
    cls: "perlite-icon-button perlite-card__more",
    attr: { type: "button", "aria-label": `Actions for ${titleWithoutTags(task)}`, "aria-haspopup": "menu" },
  });
  setIcon(more, "more-horizontal");
  more.addEventListener("click", (event) => {
    const menu = new Menu();
    if (canMove) {
      menu.addItem((item) => item.setTitle("Move to").setIsLabel(true));
      for (const column of columns) {
        if (column.accept === null) continue;
        const here = column.entries.includes(entry);
        menu.addItem((item) =>
          item
            .setTitle(column.name)
            .setIcon(column.icon)
            .setChecked(here)
            .onClick(() => {
              if (!here) void move(entry, column);
            }),
        );
      }
      menu.addSeparator();
    }
    menu.addItem((item) => item.setTitle("Open note in split").setIcon("separator-vertical").onClick(() => void openTaskNote(view.app, entry, "split")));
    menu.addItem((item) =>
      item
        .setTitle("Show details")
        .setIcon("panel-right")
        .onClick(() => {
          state.select(entry);
          void plugin.revealTaskSidebar();
        }),
    );
    menu.addItem((item) => item.setTitle("Copy markdown line").setIcon("copy").onClick(() => void copyTaskLine(task)));
    menu.showAtMouseEvent(event);
  });
  return card;
}
