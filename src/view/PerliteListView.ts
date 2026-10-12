import { ItemView, WorkspaceLeaf } from "obsidian";
import { renderEmptyState } from "../design/renderEmptyState.js";
import { renderSectionHeader } from "../design/renderSectionHeader.js";
import { renderViewHeader } from "../design/renderViewHeader.js";
import { QuickCaptureModal } from "../QuickCaptureModal.js";
import { isCompletedToday } from "../query/completedToday.js";
import { DEFAULT_SEGMENT_TITLE, DEFAULT_SEGMENTS, matchesDefaultSegment, type DefaultSegmentKind } from "../query/defaultSegments.js";
import { parserConfiguration } from "../settings.js";
import { todayCalendarDate } from "../support/today.js";
import { scanVaultTasks, type LocatedTask } from "../vaultTaskScan.js";
import { ListKeyboardNav, type KeyboardNavRow } from "./ListKeyboardNav.js";
import { renderInteractiveTaskRow } from "./taskRowInteractions.js";
import type PerlitePlugin from "../main.js";

/** Icon + accent colour per default segment — icon.ts's `PerliteIconName` union is
 * scoped to task-row rendering only (§ its own doc comment), so this reaches Obsidian's
 * `setIcon` directly via `renderSectionHeader`, the same precedent
 * `PerliteSmartListsView`'s own row icons already set. */
const SEGMENT_ICON: Readonly<Record<DefaultSegmentKind, string>> = {
  overdue: "alert-triangle",
  today: "sun",
  upcoming: "calendar",
  noDate: "inbox",
};
const SEGMENT_ACCENT: Readonly<Record<DefaultSegmentKind, string | undefined>> = {
  overdue: "perlite-accent-overdue",
  today: "perlite-accent-today",
  upcoming: "perlite-accent-upcoming",
  noDate: undefined,
};

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
 * the task's own line. Wave 2 chunk 11 adds keyboard-first triage (`J`/`K`/arrows/
 * `Enter`/`C`/`D`/`T`/`Shift+Space`) on top — see `ListKeyboardNav.ts`. The header's
 * "Show completed" toggle (persisted in `settings.showCompletedToday`) adds a fifth,
 * opt-in "Completed" segment for tasks done today — see `query/completedToday.ts`'s own
 * doc comment for why that lives outside the four-segment port below.
 */
export const PERLITE_LIST_VIEW_TYPE = "perlite-list-view";

export class PerliteListView extends ItemView {
  private readonly plugin: PerlitePlugin;
  readonly keyboardNav: ListKeyboardNav;
  private contentAreaEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PerlitePlugin) {
    super(leaf);
    this.plugin = plugin;
    this.keyboardNav = new ListKeyboardNav(this, this.app, plugin, () => this.refresh());
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
    // View-header icon action — Obsidian's own point-and-click affordance for a
    // per-view action, always visible next to the tab, no right-click/command-palette
    // knowledge required. Complements (doesn't replace) the "Open smart lists" command.
    this.addAction("layout-list", "Open smart lists", () => {
      void this.plugin.activateSmartListsView();
    });

    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("perlite-list-view");
    const liveRegion = root.createDiv({ cls: "perlite-visually-hidden", attr: { "aria-live": "polite" } });
    this.contentAreaEl = root.createDiv();
    this.keyboardNav.attach(this.contentAreaEl, liveRegion);
    await this.refresh();
  }

  /** Re-scans the vault and re-renders from scratch — no incremental diffing, matching
   * the native app's own "a full rescan on every tap is not a daily driver, but a full
   * rescan after a *write* is fine" reasoning doesn't quite apply here yet (no in-memory
   * task cache exists in this view to patch instead — that's a natural target for a
   * later performance pass once real vault sizes make a full re-read/re-parse visibly
   * slow, not before). */
  async refresh(): Promise<void> {
    const container = this.contentAreaEl;
    if (container === null) return; // onOpen hasn't run yet
    container.empty();

    // Previously only reachable via the command palette's "Quick capture" command — no
    // visible affordance in the view itself, easy to miss. `QuickCaptureModal` calls
    // `plugin.refreshAllViews()` itself on a successful add, so "Add task" doesn't need
    // its own post-submit refresh call.
    const showCompleted = this.plugin.settings.showCompletedToday;
    renderViewHeader(container, {
      title: "Perlite",
      actions: [
        {
          icon: showCompleted ? "eye" : "eye-off",
          label: showCompleted ? "Hide tasks completed today" : "Show tasks completed today",
          pressed: showCompleted,
          onClick: () => {
            void this.plugin.updateSettings({ showCompletedToday: !showCompleted });
          },
        },
        {
          icon: "plus",
          label: "Add task",
          primary: true,
          onClick: () => {
            new QuickCaptureModal(this.app, this.plugin).open();
          },
        },
      ],
    });

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
      renderEmptyState(container, {
        icon: "inbox",
        title: "No tasks found.",
        hint: "Tasks are checkbox lines in your notes — add one to a note, or capture one directly.",
        action: { label: "Add task", onClick: () => new QuickCaptureModal(this.app, this.plugin).open() },
      });
      this.keyboardNav.setRows([]);
      return;
    }

    const today = todayCalendarDate();
    let anySegmentRendered = false;
    const navRows: KeyboardNavRow[] = [];

    for (const segment of DEFAULT_SEGMENTS) {
      const matching = located.filter((entry) => matchesDefaultSegment(entry.task, segment, today));
      if (matching.length === 0) continue;
      anySegmentRendered = true;

      const section = container.createDiv({ cls: "perlite-segment" });
      renderSectionHeader(section, {
        icon: SEGMENT_ICON[segment],
        title: DEFAULT_SEGMENT_TITLE[segment],
        count: matching.length,
        accentClass: SEGMENT_ACCENT[segment],
      });
      const list = section.createDiv({ cls: "perlite-segment__list" });
      for (const entry of matching) {
        navRows.push(this.renderRow(list, entry));
      }
    }

    // Opt-in "Completed" segment (toggle above) — a plugin-only addition with no native
    // app counterpart, so it's deliberately not folded into `DEFAULT_SEGMENTS`/
    // `matchesDefaultSegment` above, which stay a strict 1:1 port of the Swift
    // original's "every *incomplete* task, segmented" framing. Its rows are
    // deliberately **not** added to `navRows`: `ListKeyboardNav.completeSelected()`
    // calls `RecurrenceEngine.complete` unconditionally, with no guard against a task
    // that's already done — for a recurring task, completing it a second time would
    // insert a duplicate next-occurrence line. The status icon itself is already
    // non-interactive for a done task (`isStatusInteractive`), so this only closes the
    // same gap for the keyboard path.
    if (this.plugin.settings.showCompletedToday) {
      const completedToday = located.filter((entry) => isCompletedToday(entry.task, today));
      if (completedToday.length > 0) {
        anySegmentRendered = true;
        const section = container.createDiv({ cls: "perlite-segment" });
        renderSectionHeader(section, { icon: "circle-check", title: "Completed", count: completedToday.length, accentClass: "perlite-accent-done" });
        const list = section.createDiv({ cls: "perlite-segment__list" });
        for (const entry of completedToday) {
          renderInteractiveTaskRow(list, this.app, this.plugin, entry.task, entry.file, this.leaf, () => this.refresh());
        }
      }
    }

    if (!anySegmentRendered) {
      renderEmptyState(container, {
        icon: "check-circle-2",
        title: "All caught up.",
        action: { label: "Add task", onClick: () => new QuickCaptureModal(this.app, this.plugin).open() },
      });
    }
    this.keyboardNav.setRows(navRows);
  }

  private renderRow(container: HTMLElement, entry: LocatedTask): KeyboardNavRow {
    const rowEl = renderInteractiveTaskRow(container, this.app, this.plugin, entry.task, entry.file, this.leaf, () => this.refresh());
    return { task: entry.task, file: entry.file, rowEl };
  }
}
