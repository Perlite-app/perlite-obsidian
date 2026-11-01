import { Notice, TFile, type App } from "obsidian";
import type { ParsedTask } from "../model/ParsedTask.js";
import * as RecurrenceEngine from "../recurrence/RecurrenceEngine.js";
import { parserConfiguration } from "../settings.js";
import { todayCalendarDate } from "../support/today.js";
import { completionEdit, DocumentEditError, type NextInstancePlacement } from "../write/documentEditor.js";
import { writeDocumentEdit } from "../write/vaultWriter.js";
import type PerlitePlugin from "../main.js";

/**
 * The recurrence-aware "complete this task" write and "open its note" every Perlite
 * surface shares (the main tab's modes, the Task sidebar, keyboard triage). Row markup
 * itself lives in `main/taskRow.ts` since the design pass.
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
    const placement = result.nextInstanceLine === null ? "above" : await tasksNextInstancePlacement(app);
    await writeDocumentEdit(app, file, completionEdit(task.raw, result, placement), task.location?.lineIndex ?? null);
  } catch (error) {
    new Notice(
      error instanceof DocumentEditError
        ? "Couldn't save — that task changed since Perlite last read this file."
        : "Couldn't save that change.",
    );
  }
}

/** The Tasks plugin's own "next recurrence appearance" choice when it's enabled, so a task
 * completed here lands where Tasks would have put it; above otherwise, Tasks' default.
 * Tasks keeps its settings in a module, not on the plugin, so this reads its saved data —
 * fresh each time, which also picks up a change made since Perlite loaded. */
async function tasksNextInstancePlacement(app: App): Promise<NextInstancePlacement> {
  const tasks = (app as App & { plugins?: { getPlugin?(id: string): { loadData(): Promise<unknown> } | null } }).plugins?.getPlugin?.(
    "obsidian-tasks-plugin",
  );
  try {
    const data = (await tasks?.loadData()) as { recurrenceOnNextLine?: unknown } | null | undefined;
    return data?.recurrenceOnNextLine === true ? "below" : "above";
  } catch {
    return "above";
  }
}

export async function openTaskInEditor(app: App, task: ParsedTask, file: TFile): Promise<void> {
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file, task.location !== null ? { eState: { line: task.location.lineIndex } } : undefined);
}
