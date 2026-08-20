import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
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

  private async refreshAllViews(): Promise<void> {
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
