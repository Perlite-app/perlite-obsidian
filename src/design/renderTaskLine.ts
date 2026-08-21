import type { ParsedTask } from "../model/ParsedTask.js";
import { renderIcon } from "./icons.js";
import { computeChipSpecs, computeSourceContext, isStatusInteractive, STATUS_ICON, tokenizeDescription, type ChipSpec } from "./taskLineModel.js";

/**
 * The DOM-building half of the chip translation layer — thin by design, consuming
 * `taskLineModel.ts`'s pure output. Every later view (list now; kanban/calendar in Wave
 * 3) renders a task through `renderTaskLine`, not its own row markup — the same
 * single-source-of-row-rendering discipline `TaskRow.swift` established on the native
 * side.
 *
 * 1:1 port of `Perlite/TaskRow.swift` + `Perlite/TaggedText.swift`'s DOM-assembly logic.
 * Their recurrence-completion visual cue (the strikethrough/reverse/date-flash
 * storyboard, `TaskRow.swift`'s own `RecurrenceCuePhase`) is deliberately **not**
 * ported here: it's presentation polish that was itself added incrementally, well after
 * basic row rendering existed, once real completion-driven UI existed to trigger it
 * (native chunks 31-34) — premature here with no write-safety layer or list view yet
 * (Wave 1 chunks 7-8). `styles.css`'s `.perlite-chip--due-flash` class is reserved for
 * that future chunk so it costs nothing to add later.
 */

export interface RenderTaskLineOptions {
  readonly task: ParsedTask;
  /** `(done, total)` among this task's subtasks, or omitted when it has none —
   * computed by the caller, not this function (see `computeChipSpecs`). */
  readonly subtaskProgress?: { done: number; total: number };
  /** This task's parent's description, or omitted for a top-level task — computed by
   * the caller, same reasoning as `subtaskProgress`. */
  readonly parentDescription?: string;
  /** Fired when the status icon is clicked on a `todo` task — never fires for
   * `done`/`cancelled`/`custom`, which all render as non-interactive glyphs (see
   * `isStatusInteractive`'s own doc comment for why `done` isn't clickable here yet). */
  readonly onStatusClick?: (task: ParsedTask) => void;
  /** Fired when an inline `#tag` chip is clicked, with the tag's raw text (including
   * its leading `#`). */
  readonly onTagClick?: (tagRaw: string) => void;
}

function renderStatusIcon(options: RenderTaskLineOptions): HTMLElement {
  const kind = options.task.status.kind;
  const interactive = isStatusInteractive(kind);
  const el = document.createElement(interactive ? "button" : "span");
  el.addClass("perlite-task-row__status", `perlite-status-${kind}`);
  if (interactive) {
    el.addClass("perlite-task-row__status--interactive");
    el.setAttribute("aria-label", "Mark task done");
    el.addEventListener("click", () => options.onStatusClick?.(options.task));
  }
  renderIcon(el, STATUS_ICON[kind]);
  return el;
}

function renderDescription(options: RenderTaskLineOptions): HTMLElement {
  const { task } = options;
  const isDone = task.status.kind === "done";
  const el = document.createElement("div");
  el.addClass("perlite-task-description");
  if (isDone) el.addClass("perlite-task-description--done");

  for (const token of tokenizeDescription(task)) {
    if (token.kind === "word") {
      el.createSpan({ cls: "perlite-task-description__word", text: token.text });
    } else {
      const chip = el.createEl("a", { cls: "perlite-tag-chip", text: token.text, href: "#" });
      chip.addEventListener("click", (event) => {
        event.preventDefault();
        options.onTagClick?.(token.text);
      });
    }
  }
  return el;
}

function renderChip(spec: ChipSpec): HTMLElement {
  const el = document.createElement("span");
  el.addClass("perlite-chip");
  if (spec.kind === "priority") el.addClass(`perlite-chip--priority-${spec.priority}`);
  if (spec.kind === "recurrence") el.addClass("perlite-chip--icon-only");
  const iconEl = el.createSpan();
  renderIcon(iconEl, spec.icon);
  if (spec.kind !== "recurrence") {
    el.createSpan({ text: spec.text });
  }
  return el;
}

/** Builds one task row's full DOM — the single entry point every view (list, kanban,
 * calendar) renders a task through. */
export function renderTaskLine(options: RenderTaskLineOptions): HTMLElement {
  const { task } = options;
  const row = document.createElement("div");
  row.addClass("perlite-task-row");

  row.appendChild(renderStatusIcon(options));

  const main = row.createDiv({ cls: "perlite-task-row__main" });

  if (options.parentDescription !== undefined) {
    const breadcrumb = main.createDiv({ cls: "perlite-task-row__breadcrumb" });
    const iconEl = breadcrumb.createSpan();
    renderIcon(iconEl, "corner-down-right");
    breadcrumb.createSpan({ text: options.parentDescription });
  }

  main.appendChild(renderDescription(options));

  const sourceContext = computeSourceContext(task);
  if (sourceContext !== null) {
    main.createDiv({ cls: "perlite-task-row__context", text: sourceContext });
  }

  const chipSpecs = computeChipSpecs(task, options.subtaskProgress);
  if (chipSpecs.length > 0) {
    const chipRow = main.createDiv({ cls: "perlite-chip-row" });
    for (const spec of chipSpecs) {
      chipRow.appendChild(renderChip(spec));
    }
  }

  return row;
}
