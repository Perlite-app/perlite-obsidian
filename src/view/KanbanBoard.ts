import { Notice, type App, type HoverParent, type TFile } from "obsidian";
import { attachDragHandle } from "../design/dragController.js";
import { renderIcon } from "../design/icons.js";
import type { ParsedTask } from "../model/ParsedTask.js";
import { PRIORITY_VALUES, type Priority } from "../model/Priority.js";
import { TASK_STATUS_CANCELLED, TASK_STATUS_TODO, type TaskStatusKind } from "../model/TaskStatus.js";
import * as TaskSerializer from "../parser/TaskSerializer.js";
import { group, STATUS_GROUP_ORDER, type GroupKey } from "../query/GroupingEngine.js";
import type { SmartList } from "../query/SmartList.js";
import { sort } from "../query/SortEngine.js";
import { sortCriterion, type SortCriterion } from "../query/SortCriterion.js";
import type { LocatedTask } from "../vaultTaskScan.js";
import { editTaskField } from "../write/editTaskField.js";
import { completeTaskAndWrite, renderInteractiveTaskRow } from "./taskRowInteractions.js";
import type PerlitePlugin from "../main.js";

/**
 * Wave 3's kanban lens — "one query, many renderers": a smart list's own filtered/sorted
 * tasks (`list.filter`/`list.sorting`, already evaluated by the caller — this module does
 * no filtering of its own), grouped into columns via the existing `GroupingEngine.group`
 * (same engine the list lens's own `Group by` display option already uses). Every card
 * renders through `renderTaskLine` (via `renderInteractiveTaskRow`) — same chip/status/
 * description markup as every other lens, per that module's own "single source of row
 * rendering" doc comment.
 *
 * Drag-to-recategorize (dragging a card between columns to change its status/priority)
 * is deliberately scoped to `status`/`priority` groupings only — both are single-valued
 * fields with an unambiguous write. `tag` grouping is many-to-many (a task with multiple
 * tags already appears in multiple columns — see `GroupingEngine.groupByTag`'s own doc
 * comment), so "dragged from column A to column B" has no unambiguous add/remove-tag
 * meaning; `file`/`folder` grouping would need a cross-file move primitive (source-delete
 * + destination-append) that doesn't exist anywhere in this port yet — the native app's
 * equivalent (`VaultViewModel.moveTask`) is much later, separately-scoped work. Boards
 * grouped by any of those three render view-only: cards, status-icon complete, and
 * click-to-open all still work, the drag handle is simply omitted.
 */

const DEFAULT_SORTING: readonly SortCriterion[] = [sortCriterion("priority"), sortCriterion("dueDate")];

const STATUS_COLUMN_LABEL: Readonly<Record<TaskStatusKind, string>> = {
  todo: "Todo",
  custom: "Custom",
  done: "Done",
  cancelled: "Cancelled",
};

const PRIORITY_COLUMN_LABEL: Readonly<Record<Priority, string>> = {
  highest: "Highest",
  high: "High",
  medium: "Medium",
  normal: "Normal",
  low: "Low",
  lowest: "Lowest",
};

interface Column {
  readonly key: string;
  readonly label: string;
  readonly tasks: readonly ParsedTask[];
}

export interface KanbanBoardOptions {
  readonly app: App;
  readonly plugin: PerlitePlugin;
  readonly list: SmartList;
  readonly located: readonly LocatedTask[];
  readonly hoverParent: HoverParent;
  readonly onAfterWrite: () => void | Promise<void>;
}

/** Renders the board into `container`. No return value — unlike the calendar lens, the
 * kanban board contributes no rows to `ListKeyboardNav` in this first cut (see the
 * module doc comment on the native/plan docs' own "Known scope cuts": a 2D column/row
 * board doesn't fit `ListKeyboardNav`'s flat row model, and a board-aware keyboard
 * controller is real, separate scope). The caller is responsible for calling
 * `keyboardNav.setRows([])` alongside this. */
export function renderKanbanBoard(container: HTMLElement, options: KanbanBoardOptions): void {
  const { list, located } = options;
  const groupKey: GroupKey = list.grouping ?? "status";
  const byTask = new Map(located.map((entry) => [entry.task, entry] as const));
  const tasks = located.map((entry) => entry.task);
  const sorted = sort(tasks, list.sorting.length > 0 ? list.sorting : DEFAULT_SORTING);
  const groups = group(sorted, groupKey);

  const draggable = groupKey === "status" || groupKey === "priority";
  const columns: readonly Column[] = draggable ? expandColumns(groupKey, groups) : groups.map((g) => ({ key: g.key, label: g.key, tasks: g.tasks }));

  const boardEl = container.createDiv({ cls: "perlite-kanban-board" });
  for (const column of columns) {
    const columnEl = boardEl.createDiv({ cls: "perlite-kanban-column" });
    columnEl.dataset.groupKey = column.key;
    columnEl.createEl("h6", { cls: "perlite-kanban-column__title", text: `${column.label} (${column.tasks.length})` });
    const bodyEl = columnEl.createDiv({ cls: "perlite-kanban-column__body" });
    for (const task of column.tasks) {
      const entry = byTask.get(task);
      if (entry === undefined) continue;
      renderCard(bodyEl, options, entry.task, entry.file, draggable ? (groupKey as "status" | "priority") : null);
    }
  }
}

/** Every status/priority value gets a column, even ones with zero current tasks — a
 * status/priority with nothing in it right now must still be a valid drop target. */
function expandColumns(groupKey: "status" | "priority", groups: readonly { key: string; tasks: readonly ParsedTask[] }[]): Column[] {
  const byKey = new Map(groups.map((g) => [g.key, g.tasks] as const));
  if (groupKey === "status") {
    return STATUS_GROUP_ORDER.map((kind) => ({ key: kind, label: STATUS_COLUMN_LABEL[kind], tasks: byKey.get(kind) ?? [] }));
  }
  return PRIORITY_VALUES.map((value) => ({ key: value, label: PRIORITY_COLUMN_LABEL[value], tasks: byKey.get(value) ?? [] }));
}

function renderCard(
  bodyEl: HTMLElement,
  options: KanbanBoardOptions,
  task: ParsedTask,
  file: TFile,
  draggableGroupKey: "status" | "priority" | null,
): void {
  const cardEl = bodyEl.createDiv({ cls: "perlite-kanban-card" });
  let handleEl: HTMLElement | null = null;
  if (draggableGroupKey !== null) {
    handleEl = cardEl.createDiv({ cls: "perlite-drag-handle", attr: { "aria-hidden": "true" } });
    renderIcon(handleEl, "grip-vertical");
  }
  renderInteractiveTaskRow(cardEl, options.app, options.plugin, task, file, options.hoverParent, options.onAfterWrite);
  if (handleEl !== null && draggableGroupKey !== null) {
    attachDragHandle(handleEl, cardEl, {
      dropTargetSelector: ".perlite-kanban-column",
      onDrop: (columnEl) => {
        const targetKey = columnEl.dataset.groupKey;
        if (targetKey !== undefined) void handleDrop(options, task, file, draggableGroupKey, targetKey);
      },
    });
  }
}

async function handleDrop(
  options: KanbanBoardOptions,
  task: ParsedTask,
  file: TFile,
  groupKey: "status" | "priority",
  targetKey: string,
): Promise<void> {
  if (groupKey === "priority") {
    await editTaskField(options.app, file, task, (t) => TaskSerializer.setPriority(t, targetKey as Priority));
    await options.onAfterWrite();
    return;
  }

  const kind = targetKey as TaskStatusKind;
  if (kind === task.status.kind) return; // dropped back onto its own column — a no-op

  if (kind === "custom") {
    // There's no single canonical symbol a "Custom" column could assign — this repo's
    // model deliberately keeps custom status symbols opaque (`TaskStatus.ts`'s own doc
    // comment). A drop here is a documented no-op, not a silent guess.
    new Notice("Custom statuses can't be set by dragging a card — edit the task directly.");
    return;
  }

  if (kind === "done") {
    // Recurrence-aware completion — the same write every other "mark done" interaction
    // in this codebase uses (`taskRowInteractions.completeTaskAndWrite`), not a raw
    // status-character write, so a recurring task's next instance is still generated.
    await completeTaskAndWrite(options.app, options.plugin, task, file);
    await options.onAfterWrite();
    return;
  }

  if (task.status.kind === "done") {
    // Reopening a done task (clearing `✅`, and — for a recurring task — removing the
    // already-generated next instance) has no equivalent to the native app's own
    // `uncomplete` in this port yet. Rather than leave a stale `✅` field behind with a
    // silently wrong status character, this is a documented no-op until that primitive
    // exists.
    new Notice("Reopening a done task isn't supported yet — edit the task directly.");
    return;
  }

  const newStatus = kind === "todo" ? TASK_STATUS_TODO : TASK_STATUS_CANCELLED;
  await editTaskField(options.app, file, task, (t) => TaskSerializer.setStatus(t, newStatus));
  await options.onAfterWrite();
}
