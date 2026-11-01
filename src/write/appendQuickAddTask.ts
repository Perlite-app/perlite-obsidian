import { normalizePath, Notice, type App } from "obsidian";
import type { ParsedTask } from "../model/ParsedTask.js";
import { parseDocument, splitLines, type DocumentHeading } from "../parser/DocumentParser.js";
import { serialize } from "../parser/TaskSerializer.js";
import { appendEdit, insertEdit, type LineDocument } from "./documentEditor.js";
import { writeDocumentEdit } from "./vaultWriter.js";

/**
 * Wave 2 chunk 13's capture write path: append a freshly built task line to the
 * configured inbox file, creating it (and any missing parent folder) if it doesn't
 * exist yet. Reuses `appendEdit`/`writeDocumentEdit` (Wave 1 chunk 7) for an existing,
 * non-empty file — the same coordinated, content-matched write every other mutation in
 * this plugin goes through — rather than a second write path just for capture.
 *
 * `heading`: put the task under that heading instead (`insertEdit`), found again in the
 * note as it is now; refused with a notice when it's gone.
 */
export async function appendQuickAddTask(app: App, task: ParsedTask, targetPath: string, heading: DocumentHeading | null = null): Promise<boolean> {
  const path = normalizePath(targetPath);
  const line = serialize(task);
  // Putting the task anywhere but under the chosen heading would be guessing.
  const headingGone = (): false => {
    new Notice(`“${heading?.text ?? ""}” isn't a heading in ${path} any more, so nothing was added.`);
    return false;
  };

  const existing = app.vault.getFileByPath(path);
  if (existing === null) {
    if (heading !== null) return headingGone();
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
    if (heading !== null) {
      const inserted = insertEdit(line, heading, parseDocument(content, path));
      if (inserted === null) return headingGone();
      await writeDocumentEdit(app, existing, inserted.edit, inserted.preferringLineIndex);
      return true;
    }
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
