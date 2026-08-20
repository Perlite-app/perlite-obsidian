import { Notice, TFile, type App, type HoverParent } from "obsidian";
import { renderTaskLine } from "../design/renderTaskLine.js";
import type { ParsedTask } from "../model/ParsedTask.js";
import { PERLITE_HOVER_LINK_SOURCE_ID } from "../hoverLinkSource.js";
import * as RecurrenceEngine from "../recurrence/RecurrenceEngine.js";
import { parserConfiguration } from "../settings.js";
import { todayCalendarDate } from "../support/today.js";
import { DocumentEditError } from "../write/documentEditor.js";
import { writeDocumentEdit } from "../write/vaultWriter.js";
import type PerlitePlugin from "../main.js";

/**
 * The shared "tap to complete / click to open" row behaviour every task-list surface in
 * this plugin uses (the default segmented list, the smart-list hub's own detail view) —
 * factored out once a second view needed the exact same interaction `PerliteListView`
 * already had, rather than a divergent copy per view.
 */

export async function completeTaskAndWrite(app: App, plugin: PerlitePlugin, task: ParsedTask, file: TFile): Promise<void> {
  const configuration = parserConfiguration(plugin.settings);
  const today = todayCalendarDate();

  let result: RecurrenceEngine.CompletionResult;
  try {
    result = RecurrenceEngine.complete(task, today, configuration);
  } catch (error) {
    new Notice(error instanceof RecurrenceEngine.CompletionError ? `Couldn't complete: ${error.message}` : "Couldn't complete task.");
    return;
  }

  try {
    await writeDocumentEdit(
      app,
      file,
      { locate: task.raw, replacement: result.completedLine, insert: result.nextInstanceLine ?? undefined },
      task.location?.lineIndex ?? null,
    );
  } catch (error) {
    new Notice(
      error instanceof DocumentEditError
        ? "Couldn't save — that task changed since Perlite last read this file."
        : "Couldn't save that change.",
    );
  }
}

export async function openTaskInEditor(app: App, task: ParsedTask, file: TFile): Promise<void> {
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file, task.location !== null ? { eState: { line: task.location.lineIndex } } : undefined);
}

/** Builds and appends one interactive task row: click the status icon to complete
 * (`onAfterWrite` re-renders the caller's own view once the write settles), click
 * anywhere else on the row to open the source note. Returns the row element so the
 * caller can also register it with `ListKeyboardNav` (Wave 2 chunk 11). `hoverParent`
 * (typically the owning view's own `leaf`, which already implements `HoverParent`) is
 * what Wave 2 chunk 12's inline context hover attaches its popover lifecycle to. */
export function renderInteractiveTaskRow(
  container: HTMLElement,
  app: App,
  plugin: PerlitePlugin,
  task: ParsedTask,
  file: TFile,
  hoverParent: HoverParent,
  onAfterWrite: () => void | Promise<void>,
): HTMLElement {
  const row = renderTaskLine({
    task,
    onStatusClick: (t) => {
      void (async () => {
        await completeTaskAndWrite(app, plugin, t, file);
        await onAfterWrite();
      })();
    },
  });
  row.addClass("perlite-list-view__row");
  // Clicking the status icon, a tag chip, or (Wave 3) a kanban/calendar drag handle must
  // not *also* open the note — the first two are their own real `<button>`/`<a>`
  // elements that already handle their own click, and the handle's own click fires (with
  // no movement) whenever a drag is grabbed and released without actually dragging, so
  // this only opens the note when the click landed on plain row chrome.
  row.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest(".perlite-task-row__status, .perlite-tag-chip, .perlite-drag-handle")) return;
    void openTaskInEditor(app, task, file);
  });
  attachHoverPreview(row, app, hoverParent, task, file);
  container.appendChild(row);
  return row;
}

/** Wave 2 chunk 12: hovering the row's own "Note › Heading" context line triggers the
 * same `hover-link` workspace event a real internal link does — the core "Page preview"
 * plugin (if enabled) picks it up and shows its own popover, respecting whatever
 * modifier-key requirement the user has configured for Perlite specifically (see
 * `hoverLinkSource.ts`). Scoped to just that one element, not the whole row — the
 * context line is the part that actually reads as "a reference to a note," and native
 * internal links don't turn their surrounding non-link text into a hover target either.
 * A custom popover previewing surrounding lines (rather than the note from its top) is
 * deliberately not built here — the plan defers it "only if necessary in practice," and
 * nothing so far suggests it is. */
function attachHoverPreview(row: HTMLElement, app: App, hoverParent: HoverParent, task: ParsedTask, file: TFile): void {
  const contextEl = row.querySelector<HTMLElement>(".perlite-task-row__context");
  if (contextEl === null) return;
  const linktext = task.parentHeading !== null && task.parentHeading.length > 0 ? `${file.path}#${task.parentHeading}` : file.path;
  contextEl.addEventListener("mouseover", (event) => {
    app.workspace.trigger("hover-link", {
      event,
      source: PERLITE_HOVER_LINK_SOURCE_ID,
      hoverParent,
      targetEl: contextEl,
      linktext,
      sourcePath: file.path,
    });
  });
}
