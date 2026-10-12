import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import { allTags } from "../model/ParsedTask.js";
import { calendarDateToISOString, compareCalendarDates } from "../model/CalendarDate.js";
import { addDaysUTC, gridDates } from "../query/CalendarGrid.js";
import { DATE_LENSES, isOpen, lensesEqual, lensMatches, lensTitle, splitNotePath, type Lens } from "../query/lenses.js";
import * as BuiltInSmartLists from "../query/BuiltInSmartLists.js";
import { todayCalendarDate } from "../support/today.js";
import { fieldDate, FIELD_EMOJI, FIELD_NAME, firstWeekday, weekStart } from "./main/calendarMode.js";
import type PerlitePlugin from "../main.js";

/**
 * The "Perlite lenses" view for the left sidebar (design pass, "Plugin · List"): every
 * slice of the vault the main tab can show — the date lenses, smart lists, tags and
 * notes — each with its open count. Picking one switches the main tab (opening it if
 * needed). In Calendar mode a mini month sits on top; picking a day moves the calendar
 * there. Opened by the ribbon icon alongside the main tab.
 */
export const PERLITE_LENSES_VIEW_TYPE = "perlite-lenses-view";

const LENS_ICON: Readonly<Record<string, string>> = {
  today: "sun",
  upcoming: "calendar",
  noDate: "inbox",
  high: "flag",
  all: "layers",
};

/** Built-ins the date lenses already cover, so they don't get a second entry. */
const COVERED_BUILT_INS = new Set([BuiltInSmartLists.today.id, BuiltInSmartLists.overdue.id, BuiltInSmartLists.upcoming.id, BuiltInSmartLists.anytime.id]);

const MAX_ENTRIES = 12;

export class PerliteLensesView extends ItemView {
  private readonly plugin: PerlitePlugin;
  private showAllTags = false;
  private showAllNotes = false;

  constructor(leaf: WorkspaceLeaf, plugin: PerlitePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return PERLITE_LENSES_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Perlite lenses";
  }

  getIcon(): string {
    return "layers";
  }

  async onOpen(): Promise<void> {
    const state = this.plugin.state;
    this.registerEvent(state.on("data", () => this.render()));
    this.registerEvent(state.on("view", () => this.render()));
    this.render();
    if (!state.hasScanned) await state.rescan();
  }

  async refresh(): Promise<void> {
    this.render();
  }

  private render(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("perlite-lenses");
    const state = this.plugin.state;
    if (state.view.mode === "calendar") this.renderMiniMonth(root);

    const today = todayCalendarDate();
    const lists = state.smartLists;
    const openCount = (lens: Lens): number => state.located.filter((entry) => isOpen(entry.task) && lensMatches(entry.task, lens, today, lists)).length;

    const nav = root.createEl("nav", { cls: "perlite-lenses__group", attr: { "aria-label": "Lenses" } });
    for (const lens of DATE_LENSES) this.renderItem(nav, lens, LENS_ICON[lens.kind] ?? "circle", lensTitle(lens, lists), "", openCount(lens));

    const hidden = new Set(this.plugin.smartLists.hiddenBuiltInIDs);
    const extraLists = lists.filter((list) => !COVERED_BUILT_INS.has(list.id) && !hidden.has(list.id));
    if (extraLists.length > 0) {
      const group = this.section(root, "Smart lists");
      for (const list of extraLists) {
        const lens: Lens = { kind: "list", id: list.id };
        this.renderItem(group, lens, list.icon || "list", list.name, "", openCount(lens));
      }
    }

    const tagCounts = new Map<string, number>();
    const noteCounts = new Map<string, number>();
    for (const entry of state.located) {
      if (!isOpen(entry.task)) continue;
      for (const tag of new Set(allTags(entry.task).map((t) => t.raw.toLowerCase()))) {
        if (tag === this.plugin.settings.globalFilterTag.toLowerCase()) continue;
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
      noteCounts.set(entry.file.path, (noteCounts.get(entry.file.path) ?? 0) + 1);
    }

    const tags = [...tagCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (tags.length > 0) {
      const group = this.section(root, "Tags");
      for (const [tag, count] of this.showAllTags ? tags : tags.slice(0, MAX_ENTRIES)) {
        this.renderItem(group, { kind: "tag", tag }, "hash", tag.slice(1), "", count);
      }
      if (tags.length > MAX_ENTRIES) this.renderMore(group, this.showAllTags, () => (this.showAllTags = !this.showAllTags));
    }

    const notes = [...noteCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (notes.length > 0) {
      const group = this.section(root, "Notes");
      for (const [path, count] of this.showAllNotes ? notes : notes.slice(0, MAX_ENTRIES)) {
        const { folder, note } = splitNotePath(path);
        this.renderItem(group, { kind: "note", path }, "file", note, folder, count);
      }
      if (notes.length > MAX_ENTRIES) this.renderMore(group, this.showAllNotes, () => (this.showAllNotes = !this.showAllNotes));
    }
  }

  private section(root: HTMLElement, title: string): HTMLElement {
    const group = root.createDiv({ cls: "perlite-lenses__group" });
    group.createEl("h2", { cls: "perlite-lenses__heading", text: title });
    return group;
  }

  private renderItem(container: HTMLElement, lens: Lens, icon: string, name: string, prefix: string, count: number): void {
    const state = this.plugin.state;
    const current = lensesEqual(lens, state.lens);
    const item = container.createEl("button", {
      cls: "perlite-lenses__item",
      attr: { type: "button", "aria-current": current ? "page" : "false" },
    });
    setIcon(item.createSpan({ cls: "perlite-lenses__icon" }), icon);
    const label = item.createSpan({ cls: "perlite-lenses__name" });
    if (prefix.length > 0) label.createSpan({ cls: "perlite-lenses__prefix", text: prefix });
    label.appendText(name);
    item.createSpan({ cls: "perlite-lenses__count", text: String(count) });
    item.addEventListener("click", () => {
      state.setLens(lens);
      void this.plugin.activateListView();
    });
  }

  private renderMore(container: HTMLElement, expanded: boolean, toggle: () => void): void {
    const more = container.createEl("button", { cls: "perlite-lenses__more", text: expanded ? "Show fewer" : "Show all", attr: { type: "button" } });
    more.addEventListener("click", () => {
      toggle();
      this.render();
    });
  }

  /** Calendar mode's mini month: dots on days with open tasks (by the field the calendar
   * places by), the visible week tinted, today filled. Picking a day shows its week. */
  private renderMiniMonth(root: HTMLElement): void {
    const state = this.plugin.state;
    const today = todayCalendarDate();
    const anchor = state.calendarAnchor;
    const field = state.view.calendarField;
    const first = firstWeekday();
    const box = root.createDiv({ cls: "perlite-mini" });
    const head = box.createDiv({ cls: "perlite-mini__head" });
    head.createSpan({
      cls: "perlite-mini__title",
      text: new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(anchor.year, anchor.month - 1, 1))),
    });
    head.createSpan({ cls: "perlite-mini__field", text: `${FIELD_EMOJI[field]} ${FIELD_NAME[field]}` });

    const withTasks = new Set(
      state.located
        .filter((entry) => isOpen(entry.task))
        .map((entry) => fieldDate(entry.task, field))
        .filter((date): date is NonNullable<typeof date> => date !== null)
        .map(calendarDateToISOString),
    );
    const grid = box.createDiv({ cls: "perlite-mini__grid" });
    const weekFirst = weekStart(anchor, first);
    for (let index = 0; index < 7; index += 1) {
      const label = new Intl.DateTimeFormat(undefined, { weekday: "narrow", timeZone: "UTC" }).format(
        new Date(Date.UTC(weekFirst.year, weekFirst.month - 1, weekFirst.day + index)),
      );
      grid.createSpan({ cls: "perlite-mini__dow", text: label });
    }
    const weekLast = addDaysUTC(weekFirst, 6);
    for (const date of gridDates({ ...anchor, day: 1 }, first)) {
      const iso = calendarDateToISOString(date);
      const day = grid.createEl("button", {
        cls: "perlite-mini__day",
        text: String(date.day),
        attr: { type: "button", "aria-label": `${iso}${withTasks.has(iso) ? ", has tasks" : ""}` },
      });
      day.toggleClass("is-today", compareCalendarDates(date, today) === 0);
      day.toggleClass("is-outside", date.month !== anchor.month);
      day.toggleClass(
        "is-in-week",
        state.view.calendarRange === "week" && compareCalendarDates(date, weekFirst) >= 0 && compareCalendarDates(date, weekLast) <= 0,
      );
      day.toggleClass("has-tasks", withTasks.has(iso));
      day.addEventListener("click", () => {
        state.calendarAnchor = date;
        state.updateView({ calendarRange: "week" });
      });
    }
  }
}
