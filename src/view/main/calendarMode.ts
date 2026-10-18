import { Platform, setIcon, type ItemView } from "obsidian";
import { shortDayLabel } from "../../design/relativeDay.js";
import { calendarDateToISOString, compareCalendarDates, type CalendarDate } from "../../model/CalendarDate.js";
import { dateValueCalendarDate } from "../../model/DateValue.js";
import type { ParsedTask } from "../../model/ParsedTask.js";
import * as TaskSerializer from "../../parser/TaskSerializer.js";
import { addDaysUTC, addMonths, gridDates, weekdayOf } from "../../query/CalendarGrid.js";
import { compareForAttention, isOpen, isOverdue, splitNotePath } from "../../query/lenses.js";
import { parserConfiguration, type CalendarField } from "../../settings.js";
import { todayCalendarDate } from "../../support/today.js";
import type { LocatedTask } from "../../vaultTaskScan.js";
import { editWithUndo } from "../taskWrites.js";
import type { Toast } from "./toast.js";
import { renderStatusRing, titleWithoutTags } from "./taskRow.js";
import { completeTaskAndWrite } from "../taskRowInteractions.js";
import type PerlitePlugin from "../../main.js";

/**
 * Calendar mode (design pass, "Plugin · Calendar"): the lens's tasks placed on days by
 * one date field — Due, Scheduled or Start — in a week or month. Day-based, because
 * Tasks dates carry no time. Dropping a task on a day rewrites that field (`📅`/`⏳`/
 * `🛫`) with one `vault.process` write; dropping it on the tray of undated tasks
 * removes the field. Each write shows a toast with the new line and Undo. The mini month
 * lives in the "Perlite lenses" sidebar, not here, and no layout assumes a sidebar is
 * open.
 */

export interface CalendarModeOptions {
  readonly plugin: PerlitePlugin;
  readonly view: ItemView;
  readonly tasks: readonly LocatedTask[];
  readonly toast: Toast;
  readonly afterWrite: () => Promise<void>;
  /** Renders the List / Board / Calendar switch at the end of the toolbar. */
  readonly layoutSwitch: (container: HTMLElement) => void;
}

export const FIELD_EMOJI: Readonly<Record<CalendarField, string>> = { due: "📅", scheduled: "⏳", start: "🛫" };
export const FIELD_NAME: Readonly<Record<CalendarField, string>> = { due: "Due", scheduled: "Scheduled", start: "Start" };

export function fieldDate(task: ParsedTask, field: CalendarField): CalendarDate | null {
  return dateValueCalendarDate(field === "due" ? task.due : field === "scheduled" ? task.scheduled : task.start);
}

/** `Intl.Locale.getWeekInfo` where the runtime has it, Monday otherwise (ISO 8601).
 * 0 = Sunday … 6 = Saturday. */
export function firstWeekday(): number {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & { getWeekInfo?: () => { firstDay: number } };
    const info = locale.getWeekInfo?.();
    if (info !== undefined) return info.firstDay % 7;
  } catch {
    // fall through
  }
  return 1;
}

export function weekStart(date: CalendarDate, first: number): CalendarDate {
  return addDaysUTC(date, -((weekdayOf(date) - first + 7) % 7));
}

/** ISO week number, for the "Week 41" subtitle. */
function isoWeek(date: CalendarDate): number {
  const thursday = addDaysUTC(date, 3 - ((weekdayOf(date) + 6) % 7));
  const jan1 = Date.UTC(thursday.year, 0, 1);
  return Math.floor((Date.UTC(thursday.year, thursday.month - 1, thursday.day) - jan1) / 864e5 / 7) + 1;
}

function monthTitle(date: CalendarDate): string {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(date.year, date.month - 1, 1)));
}

function weekdayShort(date: CalendarDate): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(date.year, date.month - 1, date.day)));
}

export function renderCalendarMode(body: HTMLElement, options: CalendarModeOptions): void {
  const { plugin } = options;
  const state = plugin.state;
  const today = todayCalendarDate();
  const field = state.view.calendarField;
  const range = state.view.calendarRange;
  const first = firstWeekday();
  const anchor = state.calendarAnchor;
  const tasks = [...options.tasks].sort((a, b) => compareForAttention(a.task, b.task, today));
  let dragged: LocatedTask | null = null;

  // --- Toolbar --------------------------------------------------------------------------
  const toolbar = body.createDiv({ cls: "perlite-toolbar perlite-toolbar--pane perlite-cal-toolbar" });
  const lead = toolbar.createDiv({ cls: "perlite-cal-toolbar__lead" });
  const titles = lead.createDiv({ cls: "perlite-cal-toolbar__titles" });
  const start = range === "week" ? weekStart(anchor, first) : { ...anchor, day: 1 };
  titles.createDiv({ cls: "perlite-cal-toolbar__title", text: monthTitle(start) });
  const end = addDaysUTC(start, 6);
  titles.createDiv({
    cls: "perlite-cal-toolbar__subtitle",
    text:
      range === "week"
        ? `Week ${isoWeek(start)} · ${start.day} ${shortDayLabel(start).split(" ").at(-1)} – ${end.day} ${shortDayLabel(end).split(" ").at(-1)}`
        : `${tasks.filter((entry) => isOpen(entry.task) && fieldDate(entry.task, field)?.month === anchor.month && fieldDate(entry.task, field)?.year === anchor.year).length} open this month`,
  });
  const nav = lead.createDiv({ cls: "perlite-cal-toolbar__nav" });
  const step = (delta: number): void => {
    state.calendarAnchor = range === "week" ? addDaysUTC(anchor, 7 * delta) : addMonths({ ...anchor, day: 1 }, delta);
    state.trigger("view");
  };
  const prev = nav.createEl("button", { cls: "perlite-icon-button", attr: { type: "button", "aria-label": range === "week" ? "Previous week" : "Previous month" } });
  setIcon(prev, "chevron-left");
  prev.addEventListener("click", () => step(-1));
  const todayButton = nav.createEl("button", { cls: "perlite-button perlite-button--outline", text: "Today", attr: { type: "button" } });
  todayButton.addEventListener("click", () => {
    state.calendarAnchor = todayCalendarDate();
    state.trigger("view");
  });
  const next = nav.createEl("button", { cls: "perlite-icon-button", attr: { type: "button", "aria-label": range === "week" ? "Next week" : "Next month" } });
  setIcon(next, "chevron-right");
  next.addEventListener("click", () => step(1));

  const placeBy = toolbar.createDiv({ cls: "perlite-chips", attr: { role: "radiogroup", "aria-label": "Place tasks by" } });
  placeBy.createSpan({ cls: "perlite-chips__label", text: "Place by" });
  for (const option of ["due", "scheduled", "start"] as const) {
    const chip = placeBy.createEl("button", {
      cls: "perlite-chips__chip",
      text: `${FIELD_EMOJI[option]} ${FIELD_NAME[option]}`,
      attr: { type: "button", role: "radio", "aria-checked": String(field === option) },
    });
    chip.addEventListener("click", () => state.updateView({ calendarField: option }));
  }
  const ranges = toolbar.createDiv({ cls: "perlite-segmented", attr: { role: "radiogroup", "aria-label": "Range" } });
  for (const option of ["week", "month"] as const) {
    const button = ranges.createEl("button", {
      cls: "perlite-segmented__option",
      text: option === "week" ? "Week" : "Month",
      attr: { type: "button", role: "radio", "aria-checked": String(range === option) },
    });
    button.addEventListener("click", () => state.updateView({ calendarRange: option }));
  }
  options.layoutSwitch(toolbar);

  // --- Writes -----------------------------------------------------------------------------
  const configuration = parserConfiguration(plugin.settings);
  const place = async (entry: LocatedTask, date: CalendarDate | null): Promise<void> => {
    const from = fieldDate(entry.task, field);
    if ((from === null && date === null) || (from !== null && date !== null && compareCalendarDates(from, date) === 0)) return;
    const undo = await editWithUndo(plugin.app, entry.file, entry.task, (task) => TaskSerializer.setDate(task, field, date, configuration));
    if (undo === null) return;
    const newLine = TaskSerializer.serialize(TaskSerializer.setDate(entry.task, field, date, configuration)).trim();
    const headline = `${FIELD_EMOJI[field]} ${from !== null ? `${calendarDateToISOString(from)} → ` : ""}${date !== null ? calendarDateToISOString(date) : "removed"} · ${entry.file.path} line ${(entry.task.location?.lineIndex ?? 0) + 1}`;
    await options.afterWrite();
    options.toast.show(headline, { md: newLine, undo, onUndone: () => void options.afterWrite() });
  };

  const dropZone = (el: HTMLElement, date: CalendarDate | null): void => {
    el.addEventListener("dragover", (event) => {
      if (dragged === null) return;
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
      if (dragged !== null) void place(dragged, date);
    });
  };

  const draggable = (el: HTMLElement, entry: LocatedTask): void => {
    if (Platform.isMobile) return;
    el.setAttribute("draggable", "true");
    el.addEventListener("dragstart", (event) => {
      dragged = entry;
      event.dataTransfer?.setData("text/plain", entry.task.raw);
      el.addClass("is-dragging");
    });
    el.addEventListener("dragend", () => {
      dragged = null;
      el.removeClass("is-dragging");
      body.querySelectorAll(".is-drop-target").forEach((target) => target.removeClass("is-drop-target"));
    });
  };

  const select = (entry: LocatedTask): void => {
    state.select(entry);
    void plugin.revealTaskSidebar();
  };

  const complete = async (entry: LocatedTask): Promise<void> => {
    await completeTaskAndWrite(plugin.app, plugin, entry.task, entry.file);
    await options.afterWrite();
  };

  // --- Grid + tray --------------------------------------------------------------------
  const layout = body.createDiv({ cls: "perlite-cal" });
  const gridScroller = layout.createDiv({ cls: "perlite-cal__grid" });
  const byDay = new Map<string, LocatedTask[]>();
  for (const entry of tasks) {
    const date = fieldDate(entry.task, field);
    if (date === null) continue;
    const key = calendarDateToISOString(date);
    byDay.set(key, [...(byDay.get(key) ?? []), entry]);
  }

  if (range === "week") {
    // Two grid rows: the day headings, then the days themselves, which take the rest of
    // the height and scroll on their own.
    const week = gridScroller.createDiv({ cls: "perlite-cal-week" });
    const days = Array.from({ length: 7 }, (_, index) => addDaysUTC(start, index));
    for (const date of days) {
      const items = byDay.get(calendarDateToISOString(date)) ?? [];
      const head = week.createDiv({ cls: "perlite-cal-day__head" });
      head.toggleClass("is-today", compareCalendarDates(date, today) === 0);
      head.createSpan({ cls: "perlite-cal-day__dow", text: weekdayShort(date) });
      head.createSpan({ cls: "perlite-cal-day__num", text: String(date.day) });
      const openCount = items.filter((entry) => isOpen(entry.task)).length;
      if (openCount > 0) head.createSpan({ cls: "perlite-cal-day__load", text: `${openCount} open` });
    }
    for (const date of days) {
      const items = byDay.get(calendarDateToISOString(date)) ?? [];
      const dayEl = week.createDiv({ cls: "perlite-cal-day", attr: { "aria-label": shortDayLabel(date) } });
      dayEl.toggleClass("is-today", compareCalendarDates(date, today) === 0);
      dayEl.toggleClass("is-weekend", weekdayOf(date) === 0 || weekdayOf(date) === 6);
      for (const entry of items) {
        const card = renderCalendarCard(dayEl, entry, today, field, select, complete, state.isSelected(entry));
        draggable(card, entry);
      }
      dropZone(dayEl, date);
    }
  } else {
    const month = gridScroller.createDiv({ cls: "perlite-cal-month" });
    for (let index = 0; index < 7; index += 1) {
      month.createDiv({ cls: "perlite-cal-month__dow", text: weekdayShort(addDaysUTC(weekStart(today, first), index)) });
    }
    for (const date of gridDates({ ...anchor, day: 1 }, first)) {
      const items = byDay.get(calendarDateToISOString(date)) ?? [];
      const cell = month.createDiv({ cls: "perlite-cal-cell", attr: { "aria-label": shortDayLabel(date) } });
      cell.toggleClass("is-today", compareCalendarDates(date, today) === 0);
      cell.toggleClass("is-outside", date.month !== anchor.month);
      cell.createSpan({ cls: "perlite-cal-cell__num", text: String(date.day) });
      for (const entry of items.slice(0, 3)) {
        const chip = cell.createDiv({ cls: "perlite-cal-chip", attr: { tabindex: "0", role: "button" } });
        chip.dataset.priority = entry.task.priority;
        chip.toggleClass("is-done", !isOpen(entry.task));
        chip.createSpan({ cls: "perlite-cal-chip__dot" });
        chip.createSpan({ cls: "perlite-cal-chip__title", text: titleWithoutTags(entry.task) });
        chip.addEventListener("click", () => select(entry));
        chip.addEventListener("keydown", (event) => {
          if (event.key === "Enter") select(entry);
        });
        draggable(chip, entry);
      }
      if (items.length > 3) {
        const more = cell.createEl("button", { cls: "perlite-cal-cell__more", text: `+${items.length - 3} more`, attr: { type: "button" } });
        more.addEventListener("click", () => {
          state.calendarAnchor = date;
          state.updateView({ calendarRange: "week" });
        });
      }
      dropZone(cell, date);
    }
  }

  const unplaced = tasks.filter((entry) => isOpen(entry.task) && fieldDate(entry.task, field) === null);
  const tray = layout.createDiv({ cls: "perlite-cal-tray", attr: { "aria-label": `No ${FIELD_NAME[field].toLowerCase()} date` } });
  const trayHead = tray.createDiv({ cls: "perlite-cal-tray__head" });
  trayHead.createEl("h2", { text: `No ${FIELD_NAME[field].toLowerCase()} date` });
  trayHead.createSpan({ cls: "perlite-cal-tray__count", text: String(unplaced.length) });
  tray.createEl("p", {
    cls: "perlite-cal-tray__hint",
    text: Platform.isMobile ? "Select a task to set its dates in the Task panel." : "Drag onto a day to write its date. Drag back here to remove it.",
  });
  for (const entry of unplaced) {
    const card = renderCalendarCard(tray, entry, today, field, select, complete, state.isSelected(entry));
    draggable(card, entry);
  }
  dropZone(tray, null);
}

function renderCalendarCard(
  container: HTMLElement,
  entry: LocatedTask,
  today: CalendarDate,
  field: CalendarField,
  onSelect: (entry: LocatedTask) => void,
  onComplete: (entry: LocatedTask) => Promise<void>,
  selected: boolean,
): HTMLElement {
  const task = entry.task;
  const open = isOpen(task);
  const card = container.createDiv({ cls: "perlite-card perlite-card--calendar" });
  card.toggleClass("is-done", !open);
  card.toggleClass("is-selected", selected);
  const toggle = card.createEl("button", {
    cls: "perlite-row__toggle",
    attr: { type: "button", "aria-label": open ? `Complete: ${titleWithoutTags(task)}` : `Done: ${titleWithoutTags(task)}` },
  });
  renderStatusRing(toggle, task);
  toggle.disabled = !open;
  toggle.addEventListener("click", () => void onComplete(entry));
  const main = card.createEl("button", { cls: "perlite-card__main perlite-card__select", attr: { type: "button" } });
  main.createSpan({ cls: "perlite-card__title", text: titleWithoutTags(task) });
  const meta = main.createSpan({ cls: "perlite-card__meta" });
  if (field === "due" && isOverdue(task, today)) meta.createSpan({ cls: "perlite-pill is-overdue", text: "Overdue" });
  if (task.recurrenceRule !== null) setIcon(meta.createSpan({ cls: "perlite-row__icon" }), "repeat");
  meta.createSpan({ cls: "perlite-row__note", text: splitNotePath(entry.file.path).note });
  main.addEventListener("click", () => onSelect(entry));
  return card;
}
