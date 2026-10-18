import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import { AddTagModal } from "../AddTagModal.js";
import { PRIORITY_ICON } from "../design/priorityIcon.js";
import { relativeDayLabel } from "../design/relativeDay.js";
import { dateValueCalendarDate } from "../model/DateValue.js";
import type { Priority } from "../model/Priority.js";
import { createTaskTag } from "../model/TaskTag.js";
import * as TaskSerializer from "../parser/TaskSerializer.js";
import { isOverdue, priorityTitle } from "../query/lenses.js";
import { RescheduleModal } from "../RescheduleModal.js";
import { parserConfiguration, type CalendarField } from "../settings.js";
import { todayCalendarDate } from "../support/today.js";
import { titleWithoutTags } from "./main/taskRow.js";
import { editWithUndo, openTaskNote, setStatusChoice, statusChoiceOf, type StatusChoice } from "./taskWrites.js";
import type PerlitePlugin from "../main.js";

/**
 * The "Task" view for the right sidebar (design pass, "Plugin · List"): the task
 * selected in the main tab, follows the selection through the shared state's
 * `"selection"` event. Status and priority as segmented controls; dates, repeat and tags
 * as rows (a date row opens the reschedule palette for that field); the literal line
 * and a link to it in the note. Every edit is one `vault.process` write.
 */
export const PERLITE_TASK_VIEW_TYPE = "perlite-task-view";

const STATUS_OPTIONS: readonly [StatusChoice, string][] = [
  ["todo", "To do"],
  ["doing", "Doing"],
  ["done", "Done"],
  ["cancelled", "Cancel"],
];

const PRIORITY_ORDER: readonly Priority[] = ["normal", "lowest", "low", "medium", "high", "highest"];
const PRIORITY_SHORT: Readonly<Record<Priority, string>> = { normal: "None", lowest: "Lowest", low: "Low", medium: "Med", high: "High", highest: "Top" };

export class PerliteTaskView extends ItemView {
  private readonly plugin: PerlitePlugin;

  constructor(leaf: WorkspaceLeaf, plugin: PerlitePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return PERLITE_TASK_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Task";
  }

  getIcon(): string {
    return "circle-dot";
  }

  async onOpen(): Promise<void> {
    this.registerEvent(this.plugin.state.on("selection", () => this.render()));
    this.registerEvent(this.plugin.state.on("data", () => this.render()));
    this.render();
  }

  async refresh(): Promise<void> {
    this.render();
  }

  private render(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("perlite-task-panel");
    const entry = this.plugin.state.selected;
    if (entry === null) {
      root.createDiv({ cls: "perlite-task-panel__empty", text: "Select a task to see its details here." });
      return;
    }
    const task = entry.task;
    const today = todayCalendarDate();
    const configuration = parserConfiguration(this.plugin.settings);
    const write = async (mutate: Parameters<typeof editWithUndo>[3]): Promise<void> => {
      await editWithUndo(this.app, entry.file, task, mutate);
      await this.plugin.refreshAllViews();
    };

    const head = root.createDiv({ cls: "perlite-task-panel__head" });
    head.createDiv({ cls: "perlite-task-panel__where", text: `${entry.file.name} · line ${(task.location?.lineIndex ?? 0) + 1}` });
    head.createDiv({ cls: "perlite-task-panel__title", text: titleWithoutTags(task) });

    const current = statusChoiceOf(task);
    const status = root.createDiv({ cls: "perlite-segmented perlite-segmented--fill", attr: { role: "radiogroup", "aria-label": "Status" } });
    for (const [choice, label] of STATUS_OPTIONS) {
      const button = status.createEl("button", {
        cls: "perlite-segmented__option",
        text: label,
        attr: { type: "button", role: "radio", "aria-checked": String(current === choice) },
      });
      button.addEventListener("click", () => {
        void (async () => {
          await setStatusChoice(this.app, this.plugin, entry, choice);
          await this.plugin.refreshAllViews();
        })();
      });
    }

    const fields = root.createDiv({ cls: "perlite-fields" });
    const dateRow = (field: CalendarField, name: string, icon: string, tone: string): void => {
      const value = dateValueCalendarDate(field === "due" ? task.due : field === "scheduled" ? task.scheduled : task.start);
      const row = this.fieldRow(fields, name, icon, tone, value !== null ? relativeDayLabel(value, today) : "—");
      row.toggleClass("is-empty", value === null);
      row.toggleClass("is-overdue", field === "due" && isOverdue(task, today));
      row.addEventListener("click", () => {
        new RescheduleModal(this.app, (date) => void write((t) => TaskSerializer.setDate(t, field, date, configuration)), name.toLowerCase()).open();
      });
    };
    dateRow("due", "Due", "calendar", "red");
    dateRow("scheduled", "Scheduled", "hourglass", "purple");
    dateRow("start", "Starts", "play", "green");
    const repeat = this.fieldRow(fields, "Repeat", "repeat", "cyan", task.recurrenceRule ?? "Never");
    repeat.toggleClass("is-empty", task.recurrenceRule === null);
    repeat.disabled = true;
    const tags = this.fieldRow(fields, "Tags", "hash", "blue", task.tags.map((tag) => tag.raw).join(" ") || "Add a tag");
    tags.toggleClass("is-empty", task.tags.length === 0);
    tags.addClass("is-accent");
    tags.addEventListener("click", () => {
      new AddTagModal(this.app, (text) => void write((t) => TaskSerializer.addTag(t, createTaskTag(text), configuration))).open();
    });
    const note = this.fieldRow(fields, "Note", "file", "purple", entry.file.path);
    note.addEventListener("click", () => void openTaskNote(this.app, entry, "tab"));

    const priorityBlock = root.createDiv({ cls: "perlite-task-panel__block" });
    priorityBlock.createDiv({ cls: "perlite-task-panel__label", text: "Priority" });
    const priorities = priorityBlock.createDiv({ cls: "perlite-segmented perlite-segmented--fill perlite-segmented--stacked", attr: { role: "radiogroup", "aria-label": "Priority" } });
    for (const priority of PRIORITY_ORDER) {
      const button = priorities.createEl("button", {
        cls: "perlite-segmented__option",
        attr: { type: "button", role: "radio", "aria-checked": String(task.priority === priority), "aria-label": priorityTitle(priority), title: priorityTitle(priority) },
      });
      button.dataset.priority = priority;
      setIcon(button.createSpan({ cls: "perlite-segmented__icon" }), PRIORITY_ICON[priority]);
      button.createSpan({ text: PRIORITY_SHORT[priority] });
      button.addEventListener("click", () => void write((t) => TaskSerializer.setPriority(t, priority, configuration)));
    }

    const md = root.createDiv({ cls: "perlite-task-panel__block" });
    md.createDiv({ cls: "perlite-task-panel__label", text: "In the note" });
    md.createEl("code", { cls: "perlite-task-panel__md", text: task.raw.trim() });
    const open = md.createEl("a", { cls: "perlite-task-panel__open", text: `Open ${entry.file.name} at line ${(task.location?.lineIndex ?? 0) + 1}`, href: "#" });
    setIcon(open.createSpan(), "arrow-right");
    open.addEventListener("click", (event) => {
      event.preventDefault();
      void openTaskNote(this.app, entry, "tab");
    });
  }

  private fieldRow(container: HTMLElement, name: string, icon: string, tone: string, value: string): HTMLButtonElement {
    const row = container.createEl("button", { cls: "perlite-field", attr: { type: "button" } });
    const tile = row.createSpan({ cls: "perlite-field__tile" });
    tile.dataset.tone = tone;
    setIcon(tile, icon);
    row.createSpan({ cls: "perlite-field__name", text: name });
    row.createSpan({ cls: "perlite-field__value", text: value });
    return row;
  }
}
