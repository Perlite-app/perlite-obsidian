import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { PERLITE_HOVER_LINK_SOURCE, PERLITE_HOVER_LINK_SOURCE_ID } from "./hoverLinkSource.js";
import { QuickCaptureModal } from "./QuickCaptureModal.js";
import { loadStoredSmartLists, saveStoredSmartLists } from "./SmartListStore.js";
import { EMPTY_STORED_SMART_LISTS, type StoredSmartLists } from "./query/StoredSmartLists.js";
import { PerliteSettingTab } from "./SettingsTab.js";
import { DEFAULT_SETTINGS, type PerliteSettings } from "./settings.js";
import { PERLITE_LIST_VIEW_TYPE, PerliteListView } from "./view/PerliteListView.js";
import { PERLITE_SMART_LIST_DETAIL_VIEW_TYPE, PerliteSmartListDetailView } from "./view/PerliteSmartListDetailView.js";
import { PERLITE_SMART_LISTS_VIEW_TYPE, PerliteSmartListsView } from "./view/PerliteSmartListsView.js";

export default class PerlitePlugin extends Plugin {
  settings: PerliteSettings = DEFAULT_SETTINGS;
  smartLists: StoredSmartLists = EMPTY_STORED_SMART_LISTS;

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.loadSmartLists();

    this.registerView(PERLITE_LIST_VIEW_TYPE, (leaf) => new PerliteListView(leaf, this));
    this.registerView(PERLITE_SMART_LISTS_VIEW_TYPE, (leaf) => new PerliteSmartListsView(leaf, this));
    this.registerView(PERLITE_SMART_LIST_DETAIL_VIEW_TYPE, (leaf) => new PerliteSmartListDetailView(leaf, this));
    this.addSettingTab(new PerliteSettingTab(this.app, this));
    // Wave 2 chunk 12: shows Perlite under the core "Page preview" plugin's own
    // settings, so the user controls whether hovering a task row's note reference
    // requires the Mod key — Perlite itself never decides that.
    this.registerHoverLinkSource(PERLITE_HOVER_LINK_SOURCE_ID, PERLITE_HOVER_LINK_SOURCE);

    this.addRibbonIcon("circle-check", "Open Perlite", () => {
      void this.activateListView();
    });
    this.addCommand({
      id: "open-list-view",
      name: "Open task list",
      callback: () => {
        void this.activateListView();
      },
    });
    this.addCommand({
      id: "open-smart-lists",
      name: "Open smart lists",
      callback: () => {
        void this.activateSmartListsView();
      },
    });
    this.registerListNavCommands();

    this.addCommand({
      id: "quick-capture",
      name: "Quick capture",
      callback: () => {
        new QuickCaptureModal(this.app, this).open();
      },
    });
  }

  /** Wave 2 chunk 11: every `ListKeyboardNav` action is *also* registered here via
   * `checkCallback`, so Obsidian's own Hotkeys settings can show, and let a user
   * rebind, these bindings — `ListKeyboardNav.attach`'s `Scope` registration is what
   * makes the bare unmodified letter actually fire without a modifier, which
   * `addCommand` alone can't do for a single-letter binding with no modifier key, but
   * both paths call the exact same `ListKeyboardNav` methods, so they can never drift
   * out of sync with each other. `checkCallback` returns `false` (command hidden/
   * disabled) whenever no Perlite list view is currently active. */
  private registerListNavCommands(): void {
    const withActiveNav = (action: (nav: PerliteListView["keyboardNav"]) => void) => (checking: boolean): boolean => {
      const nav = this.activeListNav();
      if (nav === null) return false;
      if (!checking) action(nav);
      return true;
    };
    this.addCommand({ id: "select-next-task", name: "Select next task", checkCallback: withActiveNav((nav) => nav.moveSelection(1)) });
    this.addCommand({ id: "select-previous-task", name: "Select previous task", checkCallback: withActiveNav((nav) => nav.moveSelection(-1)) });
    this.addCommand({ id: "open-selected-task", name: "Open selected task's note", checkCallback: withActiveNav((nav) => void nav.openSelected()) });
    this.addCommand({ id: "complete-selected-task", name: "Complete selected task", checkCallback: withActiveNav((nav) => void nav.completeSelected()) });
    this.addCommand({ id: "reschedule-selected-task", name: "Reschedule selected task", checkCallback: withActiveNav((nav) => nav.rescheduleSelected()) });
    this.addCommand({ id: "tag-selected-task", name: "Add tag to selected task", checkCallback: withActiveNav((nav) => nav.tagSelected()) });
    this.addCommand({
      id: "toggle-selected-task-context",
      name: "Toggle selected task's inline context",
      checkCallback: withActiveNav((nav) => nav.toggleExpanded()),
    });
  }

  private activeListNav(): PerliteListView["keyboardNav"] | null {
    const listView = this.app.workspace.getActiveViewOfType(PerliteListView);
    if (listView !== null) return listView.keyboardNav;
    const detailView = this.app.workspace.getActiveViewOfType(PerliteSmartListDetailView);
    if (detailView !== null) return detailView.keyboardNav;
    return null;
  }

  onunload(): void {}

  private async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<PerliteSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...stored };
  }

  private async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** The one place a settings-tab control writes a change — persists it, then
   * re-scans every already-open list view so a folder exclusion or global-filter
   * change is reflected immediately, not only on the view's next manual refresh. */
  async updateSettings(partial: Partial<PerliteSettings>): Promise<void> {
    this.settings = { ...this.settings, ...partial };
    await this.saveSettings();
    await this.refreshAllViews();
  }

  /** Loads the vault-stored smart-list definitions (`SmartListStore.ts`) into memory.
   * A `corrupt` result surfaces a persistent `Notice` (not a transient one — this is
   * exactly the "never silently discarded" case that store's own doc comment exists
   * for) naming where the unreadable original was preserved; either way, falls back to
   * an empty store so the built-ins alone still work. */
  private async loadSmartLists(): Promise<void> {
    const result = await loadStoredSmartLists(this.app);
    if (result.kind === "loaded") {
      this.smartLists = result.stored;
    } else {
      this.smartLists = EMPTY_STORED_SMART_LISTS;
      if (result.kind === "corrupt") {
        new Notice(`Perlite couldn't read your saved smart lists — the old file was kept at "${result.preservedAt}".`, 0);
      }
    }
  }

  /** The one path every smart-list CRUD/reorder/hide action goes through: apply a pure
   * transform, persist it, and — only on success — update in-memory state and refresh
   * every open view. A save failure leaves `this.smartLists` untouched and surfaces a
   * `Notice`, rather than the in-memory and on-disk copies silently drifting apart. */
  async mutateSmartLists(mutator: (stored: StoredSmartLists) => StoredSmartLists): Promise<boolean> {
    const next = mutator(this.smartLists);
    const saved = await saveStoredSmartLists(this.app, next);
    if (!saved) {
      new Notice("Couldn't save that change to your smart lists.");
      return false;
    }
    this.smartLists = next;
    await this.refreshAllViews();
    return true;
  }

  /** Public: also called after a quick-capture write (`QuickCaptureModal`), not only
   * from this file's own settings/smart-list mutation paths. */
  async refreshAllViews(): Promise<void> {
    const viewTypes = [PERLITE_LIST_VIEW_TYPE, PERLITE_SMART_LISTS_VIEW_TYPE, PERLITE_SMART_LIST_DETAIL_VIEW_TYPE];
    for (const viewType of viewTypes) {
      for (const leaf of this.app.workspace.getLeavesOfType(viewType)) {
        const view = leaf.view;
        if (view instanceof PerliteListView || view instanceof PerliteSmartListsView || view instanceof PerliteSmartListDetailView) {
          await view.refresh();
        }
      }
    }
  }

  private async activateListView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(PERLITE_LIST_VIEW_TYPE);
    const leaf: WorkspaceLeaf = existing[0] ?? this.app.workspace.getLeaf(true);
    if (existing.length === 0) {
      await leaf.setViewState({ type: PERLITE_LIST_VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  private async activateSmartListsView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(PERLITE_SMART_LISTS_VIEW_TYPE);
    const leaf: WorkspaceLeaf = existing[0] ?? this.app.workspace.getLeaf(true);
    if (existing.length === 0) {
      await leaf.setViewState({ type: PERLITE_SMART_LISTS_VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }
}
