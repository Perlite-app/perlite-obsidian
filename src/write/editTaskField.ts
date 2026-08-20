import { Notice, type App, type TFile } from "obsidian";
import type { ParsedTask } from "../model/ParsedTask.js";
import { serialize } from "../parser/TaskSerializer.js";
import { DocumentEditError } from "./documentEditor.js";
import { writeDocumentEdit } from "./vaultWriter.js";

/**
 * The generic "replace this one line's field" write path — every discrete single-field
 * edit (reschedule, add a tag, …) that isn't `complete`'s own replace-*plus-insert*
 * shape shares this, mirroring the native app's `editField` in spirit: build the new
 * line via a `TaskSerializer` mutation, then a plain replace-only `DocumentEdit`.
 * `mutate` may throw (e.g. `addTag`'s `MutationError` on a malformed tag) — surfaced via
 * `Notice` here so every caller doesn't need its own try/catch for the same failure
 * shape `completeTaskAndWrite` already established for completion.
 */
export async function editTaskField(app: App, file: TFile, task: ParsedTask, mutate: (task: ParsedTask) => ParsedTask): Promise<boolean> {
  let updated: ParsedTask;
  try {
    updated = mutate(task);
  } catch (error) {
    new Notice(error instanceof Error ? error.message : "Couldn't apply that change.");
    return false;
  }

  const newLine = serialize(updated);
  if (newLine === task.raw) return true; // a genuine no-op, e.g. adding a tag that's already present

  try {
    await writeDocumentEdit(app, file, { locate: task.raw, replacement: newLine }, task.location?.lineIndex ?? null);
    return true;
  } catch (error) {
    new Notice(
      error instanceof DocumentEditError
        ? "Couldn't save — that task changed since Perlite last read this file."
        : "Couldn't save that change.",
    );
    return false;
  }
}
