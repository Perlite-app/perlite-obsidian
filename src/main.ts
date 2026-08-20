import { Plugin, WorkspaceLeaf } from "obsidian";
import { PerliteSettingTab } from "./SettingsTab.js";
import { DEFAULT_SETTINGS, type PerliteSettings } from "./settings.js";
import { PERLITE_LIST_VIEW_TYPE, PerliteListView } from "./view/PerliteListView.js";

export default class PerlitePlugin extends Plugin {
  settings: PerliteSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(PERLITE_LIST_VIEW_TYPE, (leaf) => new PerliteListView(leaf, this));
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
    for (const leaf of this.app.workspace.getLeavesOfType(PERLITE_LIST_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof PerliteListView) void view.refresh();
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
}
