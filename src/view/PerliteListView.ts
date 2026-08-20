import { ItemView, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SEGMENT_TITLE, DEFAULT_SEGMENTS, matchesDefaultSegment } from "../query/defaultSegments.js";
import { parserConfiguration } from "../settings.js";
import { todayCalendarDate } from "../support/today.js";
import { scanVaultTasks, type LocatedTask } from "../vaultTaskScan.js";
import { renderInteractiveTaskRow } from "./taskRowInteractions.js";
import type PerlitePlugin from "../main.js";

/**
 * Wave 1 chunk 8's list lens: a single centralized view showing vault tasks segmented
 * like the native app's default view (Overdue/Today/Upcoming/No Date, §6.5) — the first
 * option the plan text itself names, picked over grouping by the 6 built-in smart lists
 * since the query engine those lists need (`FilterEngine`/`SmartListEngine`) wasn't
 * ported until Wave 2 chunk 10 (now done — see `view/PerliteSmartListsView.ts` for that
 * hub); `query/defaultSegments.ts` needed no such engine and still doesn't use it.
 *
 * Click a `.todo` status icon to complete (regenerating recurrence via the ported
 * `RecurrenceEngine.complete`); click anywhere else on a row to open its source note at
 * the task's own line. There is deliberately no tap-to-uncomplete, keyboard triage, or
 * inline editing yet — those are later waves/chunks per the plan, not gaps in this one.
 */
export const PERLITE_LIST_VIEW_TYPE = "perlite-list-view";

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

    const configuration = parserConfiguration(this.plugin.settings);
    const { located, conflictPaths } = await scanVaultTasks(this.app, this.plugin.settings.excludedFolders, configuration);

    if (conflictPaths.length > 0) {
      container.createDiv({
        cls: "perlite-conflict-banner",
        text:
          conflictPaths.length === 1
            ? "1 sync-conflict file was found and excluded — resolve it in your sync client."
            : `${conflictPaths.length} sync-conflict files were found and excluded — resolve them in your sync client.`,
      });
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
    renderInteractiveTaskRow(container, this.app, this.plugin, entry.task, entry.file, () => this.refresh());
  }
}
