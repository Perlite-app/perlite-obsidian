import { Notice, TFile, type App } from "obsidian";
import { renderTaskLine } from "../design/renderTaskLine.js";
import type { ParsedTask } from "../model/ParsedTask.js";
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
 * caller can also register it with `ListKeyboardNav` (Wave 2 chunk 11). */
export function renderInteractiveTaskRow(
  container: HTMLElement,
  app: App,
  plugin: PerlitePlugin,
  task: ParsedTask,
  file: TFile,
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
  // Clicking the status icon or a tag chip must not *also* open the note — both are
  // their own real `<button>`/`<a>` elements that already handle their own click, so
  // this only opens the note when the click landed on plain row chrome.
  row.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest(".perlite-task-row__status, .perlite-tag-chip")) return;
    void openTaskInEditor(app, task, file);
  });
  container.appendChild(row);
  return row;
}
