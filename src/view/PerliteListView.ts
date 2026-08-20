import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type { CalendarDate } from "../model/CalendarDate.js";
import type { ParsedTask } from "../model/ParsedTask.js";
import { renderTaskLine } from "../design/renderTaskLine.js";
import { parseDocument } from "../parser/DocumentParser.js";
import { DEFAULT_SEGMENT_TITLE, DEFAULT_SEGMENTS, matchesDefaultSegment } from "../query/defaultSegments.js";
import * as RecurrenceEngine from "../recurrence/RecurrenceEngine.js";
import { parserConfiguration } from "../settings.js";
import { DocumentEditError } from "../write/documentEditor.js";
import { planVaultScan } from "../write/vaultScan.js";
import { writeDocumentEdit } from "../write/vaultWriter.js";
import type PerlitePlugin from "../main.js";

/**
 * Wave 1 chunk 8's list lens: a single centralized view showing vault tasks segmented
 * like the native app's default view (Overdue/Today/Upcoming/No Date, §6.5) — the first
 * option the plan text itself names, picked over grouping by the 6 built-in smart lists
 * since the query engine those lists need (`FilterEngine`/`SmartListEngine`) isn't
 * ported until Wave 2 chunk 10; `query/defaultSegments.ts` needed no such engine.
 *
 * Click a `.todo` status icon to complete (regenerating recurrence via the ported
 * `RecurrenceEngine.complete`); click anywhere else on a row to open its source note at
 * the task's own line. There is deliberately no tap-to-uncomplete, keyboard triage, or
 * inline editing yet — those are later waves/chunks per the plan, not gaps in this one.
 */
export const PERLITE_LIST_VIEW_TYPE = "perlite-list-view";

function todayCalendarDate(): CalendarDate {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

interface LocatedTask {
  readonly task: ParsedTask;
  readonly file: TFile;
}

export class PerliteListView extends ItemView {
  private readonly plugin: PerlitePlugin;

  constructor(leaf: WorkspaceLeaf, plugin: PerlitePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return PERLITE_LIST_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Perlite";
  }

  getIcon(): string {
    return "circle-check";
  }

  async onOpen(): Promise<void> {
    await this.refresh();
  }

  /** Re-scans the vault and re-renders from scratch — no incremental diffing, matching
   * the native app's own "a full rescan on every tap is not a daily driver, but a full
   * rescan after a *write* is fine" reasoning doesn't quite apply here yet (no in-memory
   * task cache exists in this view to patch instead — that's a natural target for a
   * later performance pass once real vault sizes make a full re-read/re-parse visibly
   * slow, not before). */
  async refresh(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("perlite-list-view");

    const allPaths = this.app.vault.getMarkdownFiles().map((file) => file.path);
    const { included, conflictPaths } = planVaultScan(allPaths, this.plugin.settings.excludedFolders);

    if (conflictPaths.length > 0) {
      container.createDiv({
        cls: "perlite-conflict-banner",
        text:
          conflictPaths.length === 1
            ? "1 sync-conflict file was found and excluded — resolve it in your sync client."
            : `${conflictPaths.length} sync-conflict files were found and excluded — resolve them in your sync client.`,
      });
    }

    const configuration = parserConfiguration(this.plugin.settings);
    const includedSet = new Set(included);
    const files = this.app.vault.getMarkdownFiles().filter((file) => includedSet.has(file.path));

    const located: LocatedTask[] = [];
    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      const document = parseDocument(content, file.path, configuration);
      for (const task of document.tasks) {
        located.push({ task, file });
      }
    }

    if (located.length === 0) {
      container.createDiv({ cls: "perlite-empty-state", text: "No tasks found." });
      return;
    }

    const today = todayCalendarDate();
    let anySegmentRendered = false;

    for (const segment of DEFAULT_SEGMENTS) {
      const matching = located.filter((entry) => matchesDefaultSegment(entry.task, segment, today));
      if (matching.length === 0) continue;
      anySegmentRendered = true;

      const section = container.createDiv({ cls: "perlite-segment" });
      section.createEl("h6", {
        cls: "perlite-segment__title",
        text: `${DEFAULT_SEGMENT_TITLE[segment]} (${matching.length})`,
      });
      const list = section.createDiv({ cls: "perlite-segment__list" });
      for (const entry of matching) {
        this.renderRow(list, entry);
      }
    }

    if (!anySegmentRendered) {
      container.createDiv({ cls: "perlite-empty-state", text: "All caught up." });
    }
  }

  private renderRow(container: HTMLElement, entry: LocatedTask): void {
    const row = renderTaskLine({
      task: entry.task,
      onStatusClick: (task) => {
        void this.completeTask(task, entry.file);
      },
    });
    row.addClass("perlite-list-view__row");
    // Clicking the status icon or a tag chip must not *also* open the note — both are
    // their own real `<button>`/`<a>` elements that already handle their own click, so
    // this only opens the note when the click landed on plain row chrome.
    row.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest(".perlite-task-row__status, .perlite-tag-chip")) return;
      void this.openTask(entry.task, entry.file);
    });
    container.appendChild(row);
  }

  private async completeTask(task: ParsedTask, file: TFile): Promise<void> {
    const configuration = parserConfiguration(this.plugin.settings);
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
        this.app,
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

    await this.refresh();
  }

  private async openTask(task: ParsedTask, file: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file, task.location !== null ? { eState: { line: task.location.lineIndex } } : undefined);
  }
}
