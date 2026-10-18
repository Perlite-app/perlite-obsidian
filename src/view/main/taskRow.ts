import { setIcon, type App, type HoverParent } from "obsidian";
import { relativeDayLabel } from "../../design/relativeDay.js";
import type { CalendarDate } from "../../model/CalendarDate.js";
import { dateValueCalendarDate } from "../../model/DateValue.js";
import type { ParsedTask } from "../../model/ParsedTask.js";
import { PERLITE_HOVER_LINK_SOURCE_ID } from "../../hoverLinkSource.js";
import { isOpen, isOverdue, priorityTitle, splitNotePath } from "../../query/lenses.js";
import type { LocatedTask } from "../../vaultTaskScan.js";

/**
 * The design pass's list row. A round completion control whose ring is the priority
 * colour (the native app's `TaskStatusRing`), then one line: the title without its tags
 * (cut with an ellipsis, the full text on hover), and on the right the note (when the
 * list isn't already grouped by note), a repeat mark, the tags, and the due day as a
 * pill — tinted orange when overdue. A narrow pane wraps the meta under the title
 * (`styles.css` container query).
 *
 * Colours come only from theme variables (`styles.css`), so every Obsidian theme owns
 * the palette.
 */

export interface TaskRowOptions {
  readonly entry: LocatedTask;
  readonly today: CalendarDate;
  /** Show the note name in the meta line — off when the list is grouped by note. */
  readonly showNote: boolean;
  readonly selected: boolean;
  readonly onComplete: (entry: LocatedTask) => void;
  readonly onSelect: (entry: LocatedTask, rowEl: HTMLElement) => void;
  readonly onOpen: (entry: LocatedTask) => void;
  readonly hover?: { readonly app: App; readonly parent: HoverParent };
}

/** The task's own tags taken out of the title — they're in the meta line instead. */
export function titleWithoutTags(task: ParsedTask): string {
  const tags = new Set(task.tags.map((tag) => tag.raw));
  const words = task.description.split(/\s+/).filter((word) => word.length > 0 && !tags.has(word));
  return words.length > 0 ? words.join(" ") : task.description || task.raw.trim();
}

export function renderStatusRing(container: HTMLElement, task: ParsedTask): HTMLElement {
  const ring = container.createSpan({ cls: "perlite-ring", attr: { "data-priority": task.priority, "data-status": ringStatus(task) } });
  if (task.status.kind === "done") setIcon(ring, "check");
  if (task.status.kind === "cancelled") setIcon(ring, "x");
  if (task.status.kind === "custom" && task.status.symbol === "/") ring.createSpan({ cls: "perlite-ring__dot" });
  return ring;
}

function ringStatus(task: ParsedTask): string {
  if (task.status.kind === "custom") return task.status.symbol === "/" ? "doing" : "custom";
  return task.status.kind;
}

export function renderTaskRow(container: HTMLElement, options: TaskRowOptions): HTMLElement {
  const { entry, today } = options;
  const { task } = entry;
  const open = isOpen(task);
  const row = container.createDiv({ cls: "perlite-row" });
  row.toggleClass("is-done", !open);
  row.toggleClass("is-selected", options.selected);

  const toggle = row.createEl("button", {
    cls: "perlite-row__toggle",
    attr: {
      type: "button",
      "aria-label": open ? `Complete: ${titleWithoutTags(task)}${task.priority !== "normal" ? `, ${priorityTitle(task.priority).toLowerCase()} priority` : ""}` : `Done: ${titleWithoutTags(task)}`,
    },
  });
  renderStatusRing(toggle, task);
  // Reopening isn't ported (no `uncomplete` yet), so only open tasks can be toggled.
  toggle.disabled = !open;
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    if (open) options.onComplete(entry);
  });

  const body = row.createDiv({ cls: "perlite-row__body" });
  const title = titleWithoutTags(task);
  body.createDiv({ cls: "perlite-row__title", text: title, attr: { title } });

  const meta = body.createDiv({ cls: "perlite-row__meta" });
  if (options.showNote) {
    const note = meta.createSpan({ cls: "perlite-row__note", text: splitNotePath(entry.file.path).note });
    if (options.hover !== undefined) attachHover(note, options.hover.app, options.hover.parent, entry);
  }
  if (task.recurrenceRule !== null) {
    const repeat = meta.createSpan({ cls: "perlite-row__icon", attr: { "aria-label": `Repeats ${task.recurrenceRule}` } });
    setIcon(repeat, "repeat");
  }
  if (task.tags.length > 0) {
    meta.createSpan({ cls: "perlite-row__tags", text: task.tags.map((tag) => tag.raw).join(" ") });
  }
  const due = dateValueCalendarDate(task.due);
  if (due !== null) {
    const pill = meta.createSpan({ cls: "perlite-pill", text: relativeDayLabel(due, today) });
    pill.toggleClass("is-overdue", isOverdue(task, today));
  }
  if (meta.childElementCount === 0) meta.remove();

  row.addEventListener("click", () => options.onSelect(entry, row));
  row.addEventListener("dblclick", () => options.onOpen(entry));
  return row;
}

/** Hovering the note name shows Obsidian's own page preview (the core plugin's
 * `hover-link` event, honouring the user's modifier-key setting for Perlite). */
function attachHover(el: HTMLElement, app: App, parent: HoverParent, entry: LocatedTask): void {
  const heading = entry.task.parentHeading;
  const linktext = heading !== null && heading.length > 0 ? `${entry.file.path}#${heading}` : entry.file.path;
  el.addEventListener("mouseover", (event) => {
    app.workspace.trigger("hover-link", {
      event,
      source: PERLITE_HOVER_LINK_SOURCE_ID,
      hoverParent: parent,
      targetEl: el,
      linktext,
      sourcePath: entry.file.path,
    });
  });
}
