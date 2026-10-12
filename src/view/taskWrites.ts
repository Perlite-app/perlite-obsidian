import { Notice, type App, type TFile, type WorkspaceLeaf } from "obsidian";
import type { ParsedTask } from "../model/ParsedTask.js";
import { createTaskStatus, TASK_STATUS_CANCELLED, TASK_STATUS_TODO } from "../model/TaskStatus.js";
import * as TaskSerializer from "../parser/TaskSerializer.js";
import { parserConfiguration } from "../settings.js";
import type { LocatedTask } from "../vaultTaskScan.js";
import { DocumentEditError } from "../write/documentEditor.js";
import { writeDocumentEdit } from "../write/vaultWriter.js";
import { completeTaskAndWrite } from "./taskRowInteractions.js";
import type PerlitePlugin from "../main.js";

/**
 * The design pass's write paths for the main tab, the board, the calendar and the Task
 * sidebar. Every one goes through `writeDocumentEdit` (`vault.process`), like every
 * other write in this plugin; the line is located by its exact text, so a task changed
 * since the last scan is refused rather than overwritten.
 */

/** Restores the line a write replaced — the toast's Undo. */
export type Undo = () => Promise<void>;

/** Replaces one task line with `mutate(task)` and returns how to put it back, or
 * `null` when nothing was written (no-op or refused). */
export async function editWithUndo(app: App, file: TFile, task: ParsedTask, mutate: (task: ParsedTask) => ParsedTask): Promise<Undo | null> {
  let updated: ParsedTask;
  try {
    updated = mutate(task);
  } catch (error) {
    new Notice(error instanceof Error ? error.message : "Couldn't apply that change.");
    return null;
  }
  const newLine = TaskSerializer.serialize(updated);
  if (newLine === task.raw) return null;
  const lineIndex = task.location?.lineIndex ?? null;
  try {
    await writeDocumentEdit(app, file, { locate: task.raw, replacement: newLine }, lineIndex);
  } catch (error) {
    noticeForWriteError(error);
    return null;
  }
  return async () => {
    try {
      await writeDocumentEdit(app, file, { locate: newLine, replacement: task.raw }, lineIndex);
    } catch (error) {
      noticeForWriteError(error);
    }
  };
}

function noticeForWriteError(error: unknown): void {
  new Notice(error instanceof DocumentEditError ? "Couldn't save — that task changed since Perlite last read this file." : "Couldn't save that change.");
}

export type StatusChoice = "todo" | "doing" | "done" | "cancelled";

export function statusChoiceOf(task: ParsedTask): StatusChoice | null {
  switch (task.status.kind) {
    case "todo":
      return "todo";
    case "done":
      return "done";
    case "cancelled":
      return "cancelled";
    case "custom":
      return task.status.symbol === "/" ? "doing" : null;
  }
}

/**
 * Sets a task's status the way the Task sidebar and the board's Status columns offer it.
 * Done goes through the recurrence-aware completion every "mark done" uses (so a
 * recurring task still gets its next instance — and so has no line-swap undo). Leaving
 * Done isn't offered: reopening needs the native app's `uncomplete` (clearing `✅`, and
 * removing an already-generated next instance), which isn't ported yet.
 */
export async function setStatusChoice(app: App, plugin: PerlitePlugin, entry: LocatedTask, choice: StatusChoice): Promise<Undo | null> {
  const current = statusChoiceOf(entry.task);
  if (current === choice) return null;
  if (current === "done") {
    new Notice("Reopening a done task isn't supported yet — edit the line in the note.");
    return null;
  }
  if (choice === "done") {
    await completeTaskAndWrite(app, plugin, entry.task, entry.file);
    return null;
  }
  const configuration = parserConfiguration(plugin.settings);
  const status = choice === "todo" ? TASK_STATUS_TODO : choice === "cancelled" ? TASK_STATUS_CANCELLED : createTaskStatus("/");
  return editWithUndo(app, entry.file, entry.task, (task) => TaskSerializer.setStatus(task, status, configuration));
}

/** The leaf the board last opened a note in, beside itself — reused so clicking card
 * after card repoints one split instead of stacking new ones. */
let splitLeaf: WorkspaceLeaf | null = null;

/** Opens the task's note at its line: in the most recent leaf, or (`split`) in a leaf
 * beside the Perlite tab — the board's "source note alongside" layout. */
export async function openTaskNote(app: App, entry: LocatedTask, placement: "tab" | "split"): Promise<void> {
  let leaf: WorkspaceLeaf;
  if (placement === "split") {
    const alive = splitLeaf !== null && splitLeaf.getRoot() === app.workspace.rootSplit;
    leaf = alive ? splitLeaf! : app.workspace.getLeaf("split", "vertical");
    splitLeaf = leaf;
  } else {
    leaf = app.workspace.getLeaf(false);
  }
  const line = entry.task.location?.lineIndex;
  await leaf.openFile(entry.file, line !== undefined ? { eState: { line }, active: placement === "tab" } : undefined);
}

export async function copyTaskLine(task: ParsedTask): Promise<void> {
  try {
    await navigator.clipboard.writeText(task.raw.trim());
    new Notice("Copied the markdown line.");
  } catch {
    new Notice("Couldn't copy to the clipboard.");
  }
}
