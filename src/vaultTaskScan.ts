import type { App, TFile } from "obsidian";
import type { ParsedTask } from "./model/ParsedTask.js";
import { parseDocument } from "./parser/DocumentParser.js";
import type { ParserConfiguration } from "./parser/ParserConfiguration.js";
import { planVaultScan } from "./write/vaultScan.js";

/**
 * The one shared "read every included markdown file and parse its tasks" routine —
 * factored out once `PerliteSmartListsView`/`PerliteSmartListDetailView` needed the
 * exact same scan `PerliteListView` already did, rather than a second, divergent copy.
 * No in-memory task cache exists yet to patch incrementally after a write — see
 * `PerliteListView.refresh`'s own doc comment for why that's a deliberate, deferred
 * concern, not a gap specific to this file.
 */
export interface LocatedTask {
  readonly task: ParsedTask;
  readonly file: TFile;
}

export interface VaultTaskScanResult {
  readonly located: readonly LocatedTask[];
  readonly conflictPaths: readonly string[];
}

export async function scanVaultTasks(app: App, excludedFolders: readonly string[], configuration: ParserConfiguration): Promise<VaultTaskScanResult> {
  const allPaths = app.vault.getMarkdownFiles().map((file) => file.path);
  const { included, conflictPaths } = planVaultScan(allPaths, excludedFolders);
  const includedSet = new Set(included);
  const files = app.vault.getMarkdownFiles().filter((file) => includedSet.has(file.path));

  const located: LocatedTask[] = [];
  for (const file of files) {
    const content = await app.vault.cachedRead(file);
    const document = parseDocument(content, file.path, configuration);
    for (const task of document.tasks) {
      located.push({ task, file });
    }
  }
  return { located, conflictPaths };
}
