import { normalizePath, Notice, type App } from "obsidian";
import type { ParsedTask } from "../model/ParsedTask.js";
import { splitLines } from "../parser/DocumentParser.js";
import { serialize } from "../parser/TaskSerializer.js";
import { appendEdit, type LineDocument } from "./documentEditor.js";
import { writeDocumentEdit } from "./vaultWriter.js";

/**
 * Wave 2 chunk 13's capture write path: append a freshly built task line to the
 * configured inbox file, creating it (and any missing parent folder) if it doesn't
 * exist yet. Reuses `appendEdit`/`writeDocumentEdit` (Wave 1 chunk 7) for an existing,
 * non-empty file — the same coordinated, content-matched write every other mutation in
 * this plugin goes through — rather than a second write path just for capture.
 */
export async function appendQuickAddTask(app: App, task: ParsedTask, targetPath: string): Promise<boolean> {
  const path = normalizePath(targetPath);
  const line = serialize(task);

  const existing = app.vault.getFileByPath(path);
  if (existing === null) {
    try {
      await ensureParentFolderExists(app, path);
      await app.vault.create(path, `${line}\n`);
      return true;
    } catch {
      new Notice(`Couldn't create "${path}".`);
      return false;
    }
  }

  try {
    const content = await app.vault.cachedRead(existing);
    const document: LineDocument = { lines: splitLines(content) };
    const appended = appendEdit(line, document);
    if (appended === null) {
      // An existing but genuinely empty file has no line to anchor an insert-after
      // to — the same limitation `DocumentEditor.appendEdit` itself documents.
      await app.vault.modify(existing, `${line}\n`);
      return true;
    }
    await writeDocumentEdit(app, existing, appended.edit, appended.preferringLineIndex);
    return true;
  } catch {
    new Notice(`Couldn't add the task to "${path}".`);
    return false;
  }
}

async function ensureParentFolderExists(app: App, path: string): Promise<void> {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) return; // vault-root target, no folder to create
  const folderPath = path.slice(0, lastSlash);
  if (app.vault.getAbstractFileByPath(folderPath) !== null) return;
  await app.vault.createFolder(folderPath);
}
