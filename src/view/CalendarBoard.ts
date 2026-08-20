import type { App, HoverParent, TFile } from "obsidian";
import { attachDragHandle } from "../design/dragController.js";
import { renderIcon } from "../design/icons.js";
import { calendarDateToISOString, compareCalendarDates, parseCalendarDate, type CalendarDate } from "../model/CalendarDate.js";
import type { ParsedTask } from "../model/ParsedTask.js";
import { PRIORITY_VALUES, type Priority } from "../model/Priority.js";
import * as TaskSerializer from "../parser/TaskSerializer.js";
import { anchorDate, index, overdue } from "../query/CalendarIndex.js";
import { addMonths, gridDates } from "../query/CalendarGrid.js";
import type { SmartList } from "../query/SmartList.js";
import { sort } from "../query/SortEngine.js";
import { sortCriterion, type SortCriterion } from "../query/SortCriterion.js";
import { todayCalendarDate } from "../support/today.js";
import type { LocatedTask } from "../vaultTaskScan.js";
import { editTaskField } from "../write/editTaskField.js";
import type { KeyboardNavRow } from "./ListKeyboardNav.js";
import { renderInteractiveTaskRow } from "./taskRowInteractions.js";
import type PerlitePlugin from "../main.js";

/**
 * Wave 3's calendar lens — month grid above, day agenda below, mirroring the native
 * app's own `CalendarTabView.swift` layout (month + day agenda, no week view — that
 * Swift original never built one either despite "day/week/month" appearing in the
 * roadmap's prose, and nothing in this wave's scope calls for it). Vault dates only
 * (`due`/`scheduled` via `CalendarIndex.anchorDate`) — there is no Obsidian equivalent
 * to `EventKit`, so unlike the native calendar this has no device-event overlay.
 *
 * **Drag-to-reschedule is net-new** — the Swift calendar has none (its only `DragGesture`
 * pages the month; rescheduling there happens via swipe actions or the detail screen).
 * Here, dragging an agenda row onto a day cell always rewrites the `📅` field (never
 * `⏳`/`🛫` — per the plan doc's explicit "rewriting the `📅` Tasks-plugin emoji field in
 * place"), through the same `editTaskField`/`TaskSerializer.setDate` write path
 * `ListKeyboardNav`'s own `D` reschedule action already uses. No new write primitive.
 *
 * All calendar-grid date arithmetic below is pure `CalendarDate` math, using JS's own
 * UTC-pinned `Date` (`Date.UTC`/`getUTCDay`) purely as an arithmetic coordinate system —
 * `Date.UTC`-in, `getUTC*`-out never touches the system's local timezone at any point, so
 * this sidesteps the whole local-time/DST class of bug this codebase already avoids
 * elsewhere by preferring `CalendarDate` over `Date`. Same pattern (and the same reason)
 * `RecurrenceCalculator.ts`'s own `addDays`/weekday helpers already use — reimplemented
 * locally here rather than imported from there, since calendar-grid layout math is a
 * `view/` concern with no real relationship to recurrence-rule evaluation.
 */

export interface CalendarBoardState {
  /** Always day 1 of the displayed month. */
  readonly visibleMonth: CalendarDate;
  readonly selectedDate: CalendarDate;
}

export interface CalendarBoardOptions {
  readonly app: App;
  readonly plugin: PerlitePlugin;
  readonly list: SmartList;
  readonly located: readonly LocatedTask[];
  readonly hoverParent: HoverParent;
  readonly initialState: CalendarBoardState;
  /** Persists a pure navigation change (month paged, a different day selected) — no
   * vault rescan needed, since nothing about the underlying data changed. */
  readonly onStateChange: (next: CalendarBoardState) => void;
  /** Called once synchronously after the very first render, and again after every
   * subsequent in-place navigation re-render — the caller feeds this straight into
   * `ListKeyboardNav.setRows`. */
  readonly onRowsChanged: (rows: readonly KeyboardNavRow[]) => void;
  /** A real write happened (drag-to-reschedule, or completing a row from the agenda) —
   * the caller should do a full vault rescan + refresh, the same as every other lens. */
  readonly onAfterWrite: () => void | Promise<void>;
}

const DEFAULT_SORTING: readonly SortCriterion[] = [sortCriterion("priority"), sortCriterion("dueDate")];

export function renderCalendarBoard(container: HTMLElement, options: CalendarBoardOptions): void {
  let state = options.initialState;

  const rerender = (): void => {
    container.empty();
    const rows = renderInner(container, options, state, (next) => {
      state = next;
      options.onStateChange(state);
      rerender();
    });
    options.onRowsChanged(rows);
  };

  rerender();
}

function renderInner(
  container: HTMLElement,
  options: CalendarBoardOptions,
  state: CalendarBoardState,
  onNavigate: (next: CalendarBoardState) => void,
): KeyboardNavRow[] {
  const { list, located } = options;
  const today = todayCalendarDate();
  const tasks = located.map((entry) => entry.task);
  const byTask = new Map(located.map((entry) => [entry.task, entry] as const));
  const dayIndex = index(tasks);
  const sorting = list.sorting.length > 0 ? list.sorting : DEFAULT_SORTING;
  const firstWeekday = detectFirstWeekday();

  const rootEl = container.createDiv({ cls: "perlite-calendar-board" });
  renderHeader(rootEl, state, onNavigate);
  renderWeekdayRow(rootEl, firstWeekday);
  renderGrid(rootEl, state, dayIndex, today, firstWeekday, onNavigate);

  const agendaEl = rootEl.createDiv({ cls: "perlite-calendar-agenda" });
  const navRows: KeyboardNavRow[] = [];
  const isToday = compareCalendarDates(state.selectedDate, today) === 0;

  if (isToday) {
    const overdueTasks = sort(overdue(tasks, today), sorting);
    if (overdueTasks.length > 0) {
      renderAgendaSection(agendaEl, `Overdue (${overdueTasks.length})`, overdueTasks, byTask, options, navRows);
    }
  }

  const selectedDayTasks = sort(dayIndex.get(calendarDateToISOString(state.selectedDate)) ?? [], sorting);
  renderAgendaSection(agendaEl, selectedDayTitle(state.selectedDate, today), selectedDayTasks, byTask, options, navRows);

  if (navRows.length === 0) {
    agendaEl.createDiv({ cls: "perlite-empty-state", text: "Nothing on this day." });
  }

  return navRows;
}

function renderHeader(rootEl: HTMLElement, state: CalendarBoardState, onNavigate: (next: CalendarBoardState) => void): void {
  const headerEl = rootEl.createDiv({ cls: "perlite-calendar-header" });
  const prevBtn = headerEl.createEl("button", { cls: "perlite-calendar-nav", attr: { "aria-label": "Previous month" } });
  renderIcon(prevBtn, "chevron-left");
  prevBtn.addEventListener("click", () => onNavigate({ visibleMonth: addMonths(state.visibleMonth, -1), selectedDate: state.selectedDate }));

  headerEl.createEl("h6", { cls: "perlite-calendar-header__title", text: monthTitle(state.visibleMonth) });

  const nextBtn = headerEl.createEl("button", { cls: "perlite-calendar-nav", attr: { "aria-label": "Next month" } });
  renderIcon(nextBtn, "chevron-right");
  nextBtn.addEventListener("click", () => onNavigate({ visibleMonth: addMonths(state.visibleMonth, 1), selectedDate: state.selectedDate }));

  const todayBtn = headerEl.createEl("button", { cls: "perlite-calendar-nav perlite-calendar-nav--today", text: "Today" });
  todayBtn.addEventListener("click", () => {
    const today = todayCalendarDate();
    onNavigate({ visibleMonth: { ...today, day: 1 }, selectedDate: today });
  });
}

function renderWeekdayRow(rootEl: HTMLElement, firstWeekday: number): void {
  const rowEl = rootEl.createDiv({ cls: "perlite-calendar-weekdays" });
  for (const label of weekdayLabels(firstWeekday)) {
    rowEl.createDiv({ cls: "perlite-calendar-weekday", text: label });
  }
}

function renderGrid(
  rootEl: HTMLElement,
  state: CalendarBoardState,
  dayIndex: Map<string, ParsedTask[]>,
  today: CalendarDate,
  firstWeekday: number,
  onNavigate: (next: CalendarBoardState) => void,
): void {
  const gridEl = rootEl.createDiv({ cls: "perlite-calendar-grid" });
  for (const date of gridDates(state.visibleMonth, firstWeekday)) {
    const cellEl = gridEl.createDiv({ cls: "perlite-calendar-cell" });
    cellEl.dataset.date = calendarDateToISOString(date);
    if (compareCalendarDates(date, today) === 0) cellEl.addClass("perlite-calendar-cell--today");
    if (compareCalendarDates(date, state.selectedDate) === 0) cellEl.addClass("perlite-calendar-cell--selected");
    if (date.year !== state.visibleMonth.year || date.month !== state.visibleMonth.month) {
      cellEl.addClass("perlite-calendar-cell--outside-month");
    }
    cellEl.createSpan({ cls: "perlite-calendar-cell__day", text: String(date.day) });

    const dayTasks = dayIndex.get(calendarDateToISOString(date)) ?? [];
    const incomplete = dayTasks.filter((task) => task.status.kind !== "done");
    if (incomplete.length > 0) {
      const dotsEl = cellEl.createDiv({ cls: "perlite-calendar-cell__dots" });
      dotsEl.createSpan({ cls: `perlite-calendar-dot perlite-calendar-dot--priority-${highestSeverity(incomplete)}` });
    }

    cellEl.addEventListener("click", () => onNavigate({ visibleMonth: state.visibleMonth, selectedDate: date }));
  }
}

function renderAgendaSection(
  agendaEl: HTMLElement,
  title: string,
  tasks: readonly ParsedTask[],
  byTask: ReadonlyMap<ParsedTask, LocatedTask>,
  options: CalendarBoardOptions,
  navRows: KeyboardNavRow[],
): void {
  if (tasks.length === 0) return;
  const sectionEl = agendaEl.createDiv({ cls: "perlite-segment" });
  sectionEl.createEl("h6", { cls: "perlite-segment__title", text: title });
  const listEl = sectionEl.createDiv({ cls: "perlite-segment__list" });

  for (const task of tasks) {
    const entry = byTask.get(task);
    if (entry === undefined) continue;

    const rowWrapperEl = listEl.createDiv({ cls: "perlite-calendar-agenda-row" });
    const handleEl = rowWrapperEl.createDiv({ cls: "perlite-drag-handle", attr: { "aria-hidden": "true" } });
    renderIcon(handleEl, "grip-vertical");
    const rowEl = renderInteractiveTaskRow(rowWrapperEl, options.app, options.plugin, entry.task, entry.file, options.hoverParent, options.onAfterWrite);

    attachDragHandle(handleEl, rowWrapperEl, {
      dropTargetSelector: ".perlite-calendar-cell",
      onDrop: (cellEl) => {
        const iso = cellEl.dataset.date;
        const targetDate = iso !== undefined ? parseCalendarDate(iso) : null;
        if (targetDate !== null) void rescheduleDueDate(options, entry.task, entry.file, targetDate);
      },
    });

    navRows.push({ task: entry.task, file: entry.file, rowEl });
  }
}

async function rescheduleDueDate(options: CalendarBoardOptions, task: ParsedTask, file: TFile, newDate: CalendarDate): Promise<void> {
  const current = anchorDate(task);
  if (current !== null && compareCalendarDates(current, newDate) === 0) return; // dropped back on its own day — a no-op
  await editTaskField(options.app, file, task, (t) => TaskSerializer.setDate(t, "due", newDate));
  await options.onAfterWrite();
}

function highestSeverity(tasks: readonly ParsedTask[]): Priority {
  let best: Priority | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const task of tasks) {
    const rank = PRIORITY_VALUES.indexOf(task.priority);
    if (rank < bestRank) {
      bestRank = rank;
      best = task.priority;
    }
  }
  return best ?? "normal";
}

// --- Formatting helpers (locale-dependent, `Intl` only — the grid's own numeric
// arithmetic lives in the independently-tested `query/CalendarGrid.ts`) --------------------

function dateFromCalendarDate(date: CalendarDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

/** `Intl.Locale.prototype.getWeekInfo` is a newer API not yet declared in this project's
 * `lib.dom.d.ts` at its current TypeScript/lib target — feature-detected via a loose
 * cast rather than assumed, falling back to Monday (ISO 8601's own default) when
 * unsupported. A documented platform divergence, the same way this codebase records
 * every other platform-forced difference, rather than a silent wrong guess. Returns 0
 * (Sunday) .. 6 (Saturday), matching `weekdayOf`'s own numbering — `getWeekInfo`'s
 * `firstDay` is 1 (Monday) .. 7 (Sunday), and `% 7` maps that range onto this one
 * directly (Mon 1→1 .. Sat 6→6, Sun 7→0). */
function detectFirstWeekday(): number {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & { getWeekInfo?: () => { firstDay: number } };
    const info = locale.getWeekInfo?.();
    if (info !== undefined) return info.firstDay % 7;
  } catch {
    // Unsupported locale/API — fall through to the Monday default below.
  }
  return 1;
}

function weekdayLabels(firstWeekday: number): string[] {
  const formatter = new Intl.DateTimeFormat(undefined, { weekday: "narrow", timeZone: "UTC" });
  // 2023-01-01 (UTC) was a Sunday — a fixed, arbitrary reference week, never `new
  // Date()`'s current wall time, so this is deterministic regardless of when it runs.
  const sundayFirst = Array.from({ length: 7 }, (_, i) => formatter.format(new Date(Date.UTC(2023, 0, 1 + i))));
  return [...sundayFirst.slice(firstWeekday), ...sundayFirst.slice(0, firstWeekday)];
}

function monthTitle(visibleMonth: CalendarDate): string {
  const formatter = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  return formatter.format(dateFromCalendarDate(visibleMonth));
}

function selectedDayTitle(date: CalendarDate, today: CalendarDate): string {
  if (compareCalendarDates(date, today) === 0) return "Today";
  const formatter = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  return formatter.format(dateFromCalendarDate(date));
}
