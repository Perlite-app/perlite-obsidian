import { ItemView, Menu, WorkspaceLeaf, setIcon } from "obsidian";
import * as SmartListEngine from "../query/SmartListEngine.js";
import { mergeSmartListCatalog } from "../query/smartListCatalog.js";
import {
  isBuiltInID,
  withCreatedList,
  withDeletedList,
  withMovedList,
  withToggledHiddenBuiltIn,
  withUpdatedList,
} from "../query/smartListMutations.js";
import type { SmartList } from "../query/SmartList.js";
import { parserConfiguration } from "../settings.js";
import { todayCalendarDate } from "../support/today.js";
import { scanVaultTasks } from "../vaultTaskScan.js";
import { SmartListEditorModal } from "../SmartListEditorModal.js";
import { PERLITE_SMART_LIST_DETAIL_VIEW_TYPE } from "./PerliteSmartListDetailView.js";
import type PerlitePlugin from "../main.js";

/**
 * Wave 2 chunk 10's smart-list hub — built-in and user-defined lists rendered as one
 * merged list, per §6.8's "one list concept with two origins, not two parallel
 * systems." Live badge counts come from one `SmartListEngine.evaluate` pass over the
 * whole scanned vault, matching §6.8's single-pass performance requirement.
 */
export const PERLITE_SMART_LISTS_VIEW_TYPE = "perlite-smart-lists-view";

export class PerliteSmartListsView extends ItemView {
  private readonly plugin: PerlitePlugin;

  constructor(leaf: WorkspaceLeaf, plugin: PerlitePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return PERLITE_SMART_LISTS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Smart Lists";
  }

  getIcon(): string {
    return "layout-list";
  }

  async onOpen(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("perlite-list-view");

    const header = container.createDiv({ cls: "perlite-segment" });
    const headerRow = header.createDiv({ cls: "perlite-smart-lists-header" });
    headerRow.createEl("h6", { cls: "perlite-segment__title", text: "Smart Lists" });
    const newButton = headerRow.createEl("button", { text: "+ New" });
    newButton.addEventListener("click", () => {
      new SmartListEditorModal(this.app, null, (list) => {
        void this.plugin.mutateSmartLists((stored) => withCreatedList(stored, list));
      }).open();
    });

    const configuration = parserConfiguration(this.plugin.settings);
    const { located } = await scanVaultTasks(this.app, this.plugin.settings.excludedFolders, configuration);
    const catalog = mergeSmartListCatalog(this.plugin.smartLists);
    const results = SmartListEngine.evaluate(
      located.map((entry) => entry.task),
      catalog,
      todayCalendarDate(),
    );
    const countByID = new Map(results.map((r) => [r.smartList.id, r.tasks.length]));

    const hiddenIDs = new Set(this.plugin.smartLists.hiddenBuiltInIDs);
    const visible = catalog.filter((list) => !hiddenIDs.has(list.id));
    const hidden = catalog.filter((list) => hiddenIDs.has(list.id));

    const visibleSection = container.createDiv();
    for (const list of visible) {
      this.renderRow(visibleSection, list, countByID.get(list.id) ?? 0, false);
    }

    if (hidden.length > 0) {
      container.createEl("h6", { cls: "perlite-smart-lists-section-title", text: "Hidden" });
      const hiddenSection = container.createDiv();
      for (const list of hidden) {
        this.renderRow(hiddenSection, list, countByID.get(list.id) ?? 0, true);
      }
    }
  }

  private renderRow(container: HTMLElement, list: SmartList, count: number, isHidden: boolean): void {
    const row = container.createDiv({ cls: `perlite-smart-list-row${isHidden ? " perlite-smart-list-row__hidden" : ""}` });
    const iconEl = row.createDiv({ cls: "perlite-smart-list-row__icon" });
    // `list.icon` is an arbitrary Lucide name a user typed into the editor's free-text
    // field (`SmartListEditorModal`) — not restricted to `icons.ts`'s closed
    // `PerliteIconName` set, which only covers icons this plugin renders for a task's
    // own parsed fields. Obsidian's real `setIcon` accepts any valid Lucide name
    // directly, so this calls it rather than going through that narrower wrapper.
    setIcon(iconEl, list.icon);
    row.createSpan({ cls: "perlite-smart-list-row__name", text: list.name });
    row.createSpan({ cls: "perlite-smart-list-row__count", text: String(count) });

    row.addEventListener("click", () => {
      void this.openDetail(list.id);
    });
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.showMenu(event, list, isHidden);
    });
  }

  private showMenu(event: MouseEvent, list: SmartList, isHidden: boolean): void {
    const menu = new Menu();
    if (list.isBuiltIn) {
      menu.addItem((item) =>
        item
          .setTitle(isHidden ? "Show" : "Hide")
          .setIcon(isHidden ? "eye" : "eye-off")
          .onClick(() => {
            void this.plugin.mutateSmartLists((stored) => withToggledHiddenBuiltIn(stored, list.id));
          }),
      );
    } else {
      menu.addItem((item) =>
        item
          .setTitle("Edit")
          .setIcon("pencil")
          .onClick(() => {
            new SmartListEditorModal(this.app, list, (updated) => {
              void this.plugin.mutateSmartLists((stored) => withUpdatedList(stored, updated));
            }).open();
          }),
      );
      menu.addItem((item) =>
        item
          .setTitle("Delete")
          .setIcon("trash-2")
          .onClick(() => {
            void this.plugin.mutateSmartLists((stored) => withDeletedList(stored, list.id));
          }),
      );
    }
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Move up")
        .setIcon("arrow-up")
        .onClick(() => {
          void this.plugin.mutateSmartLists((stored) => withMovedList(stored, list.id, "up"));
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle("Move down")
        .setIcon("arrow-down")
        .onClick(() => {
          void this.plugin.mutateSmartLists((stored) => withMovedList(stored, list.id, "down"));
        }),
    );
    menu.showAtMouseEvent(event);
  }

  private async openDetail(smartListId: string): Promise<void> {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: PERLITE_SMART_LIST_DETAIL_VIEW_TYPE, active: true, state: { smartListId } });
  }
}
