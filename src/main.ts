import { Notice, Plugin, TFile, WorkspaceLeaf, type TAbstractFile } from "obsidian";
import { PERLITE_RIBBON_ICON_ID, registerPerliteIcon } from "./design/brandIcon.js";
import { PERLITE_HOVER_LINK_SOURCE, PERLITE_HOVER_LINK_SOURCE_ID } from "./hoverLinkSource.js";
import { QuickCaptureModal } from "./QuickCaptureModal.js";
import { loadStoredSmartLists, saveStoredSmartLists } from "./SmartListStore.js";
import { EMPTY_STORED_SMART_LISTS, type StoredSmartLists } from "./query/StoredSmartLists.js";
import { PerliteSettingTab } from "./SettingsTab.js";
import { DEFAULT_SETTINGS, type PerliteSettings } from "./settings.js";
import { createDebouncer, type Debouncer } from "./write/debounce.js";
import { PERLITE_LIST_VIEW_TYPE, PerliteListView } from "./view/PerliteListView.js";
import { PERLITE_SMART_LIST_DETAIL_VIEW_TYPE, PerliteSmartListDetailView } from "./view/PerliteSmartListDetailView.js";
import { PERLITE_SMART_LISTS_VIEW_TYPE, PerliteSmartListsView } from "./view/PerliteSmartListsView.js";
import { PERLITE_TAG_DETAIL_VIEW_TYPE, PerliteTagDetailView } from "./view/PerliteTagDetailView.js";

export default class PerlitePlugin extends Plugin {
  settings: PerliteSettings = DEFAULT_SETTINGS;
  smartLists: StoredSmartLists = EMPTY_STORED_SMART_LISTS;
  /** The one leaf every Perlite navigation repoints when `singleTabNavigation` is on —
   * see `openPerliteView`'s own doc comment for why this exists at all. `null` until the
   * first navigation; re-discovered (via `getLeaf(false)`) whenever the previously
   * tracked leaf has since been closed. */
  private perliteLeaf: WorkspaceLeaf | null = null;
  /** Coalesces a burst of vault events (e.g. every file touched by a sync client
   * settling at once) into a single re-scan, matching `write/debounce.ts`'s existing
   * "a later call always supersedes an earlier still-pending one" shape — just reused
   * here for read-side refresh instead of its usual free-text-edit write debouncing. */
  private readonly scheduleVaultRefresh: Debouncer<[]> = createDebouncer(() => {
    void this.refreshAllViews();
  }, 500);

  async onload(): Promise<void> {
    registerPerliteIcon();
    await this.loadSettings();
    await this.loadSmartLists();

    this.registerView(PERLITE_LIST_VIEW_TYPE, (leaf) => new PerliteListView(leaf, this));
    this.registerView(PERLITE_SMART_LISTS_VIEW_TYPE, (leaf) => new PerliteSmartListsView(leaf, this));
    this.registerView(PERLITE_SMART_LIST_DETAIL_VIEW_TYPE, (leaf) => new PerliteSmartListDetailView(leaf, this));
    this.registerView(PERLITE_TAG_DETAIL_VIEW_TYPE, (leaf) => new PerliteTagDetailView(leaf, this));
    this.addSettingTab(new PerliteSettingTab(this.app, this));
    // Wave 2 chunk 12: shows Perlite under the core "Page preview" plugin's own
    // settings, so the user controls whether hovering a task row's note reference
    // requires the Mod key — Perlite itself never decides that.
    this.registerHoverLinkSource(PERLITE_HOVER_LINK_SOURCE_ID, PERLITE_HOVER_LINK_SOURCE);

    this.addRibbonIcon(PERLITE_RIBBON_ICON_ID, "Open Perlite", () => {
      void this.activateListView();
    });
    // Point-and-click parity with the "Open smart lists" command below: without this,
    // the smart-list hub (and everything reached only through it — task filters, the
    // kanban/calendar lenses) was command-palette-only, undiscoverable to anyone who
    // hasn't gone looking for it by name.
    this.addRibbonIcon("layout-list", "Open Perlite smart lists", () => {
      void this.activateSmartListsView();
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

    // Every open Perlite view re-scans the vault from scratch on `refresh()` (no
    // in-memory task cache exists yet to patch instead, see `PerliteListView.refresh`'s
    // own doc comment) — but until now nothing ever *called* that refresh when a task
    // was added/edited outside the plugin (typing directly in a note, another device's
    // sync client writing a file), so a view only ever caught up on its next manual
    // reopen. `Vault.on("modify"/"create"/"delete"/"rename")` is the standard Obsidian
    // mechanism for this; filtered to markdown files only, so an image paste or
    // attachment drop doesn't trigger a pointless re-scan.
    this.registerEvent(this.app.vault.on("modify", (file) => this.handleVaultFileChange(file)));
    this.registerEvent(this.app.vault.on("create", (file) => this.handleVaultFileChange(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.handleVaultFileChange(file)));
    this.registerEvent(this.app.vault.on("rename", (file) => this.handleVaultFileChange(file)));
  }

  private handleVaultFileChange(file: TAbstractFile): void {
    if (file instanceof TFile && file.extension === "md") {
      this.scheduleVaultRefresh.schedule();
    }
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
    const tagView = this.app.workspace.getActiveViewOfType(PerliteTagDetailView);
    if (tagView !== null) return tagView.keyboardNav;
    return null;
  }

  onunload(): void {
    this.scheduleVaultRefresh.cancel();
  }

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
   * A `corrupt` or `readError` result surfaces a persistent `Notice` (not a transient
   * one — this is exactly the "never silently discarded" case that store's own doc
   * comment exists for); either way, falls back to an empty in-memory store so the
   * built-ins alone still work. **Critically, `readError` must warn too, not just
   * `corrupt`**: the file exists and is untouched on disk, but starting from an empty
   * in-memory store means the very next smart-list create/edit (`mutateSmartLists`
   * always persists from whatever's in-memory) would silently overwrite it — the user
   * needs the chance to reload/retry before that happens, not silent data loss. */
  private async loadSmartLists(): Promise<void> {
    const result = await loadStoredSmartLists(this.app);
    if (result.kind === "loaded") {
      this.smartLists = result.stored;
    } else {
      this.smartLists = EMPTY_STORED_SMART_LISTS;
      if (result.kind === "corrupt") {
        new Notice(`Perlite couldn't read your saved smart lists — the old file was kept at "${result.preservedAt}".`, 0);
      } else if (result.kind === "readError") {
        new Notice(
          "Perlite couldn't read your saved smart lists (a temporary error) — the file itself wasn't touched. " +
            "Reload the plugin or restart Obsidian before creating or editing a smart list, or you risk overwriting it with an empty one.",
          0,
        );
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
    const viewTypes = [
      PERLITE_LIST_VIEW_TYPE,
      PERLITE_SMART_LISTS_VIEW_TYPE,
      PERLITE_SMART_LIST_DETAIL_VIEW_TYPE,
      PERLITE_TAG_DETAIL_VIEW_TYPE,
    ];
    for (const viewType of viewTypes) {
      for (const leaf of this.app.workspace.getLeavesOfType(viewType)) {
        const view = leaf.view;
        if (
          view instanceof PerliteListView ||
          view instanceof PerliteSmartListsView ||
          view instanceof PerliteSmartListDetailView ||
          view instanceof PerliteTagDetailView
        ) {
          await view.refresh();
        }
      }
    }
  }

  /** Public: also called from `PerliteSmartListsView`/`PerliteSmartListDetailView`'s own
   * point-and-click "back to task list" header action, not only this file's ribbon icon
   * and command. */
  async activateListView(): Promise<void> {
    await this.openPerliteView(PERLITE_LIST_VIEW_TYPE);
  }

  /** Public: also called from `PerliteListView`/`PerliteSmartListDetailView`'s own
   * point-and-click "open smart lists" header action, not only this file's ribbon icon
   * and command. */
  async activateSmartListsView(): Promise<void> {
    await this.openPerliteView(PERLITE_SMART_LISTS_VIEW_TYPE);
  }

  /** Public: called from `PerliteSmartListsView`'s own row-click "open this list"
   * action. */
  async activateSmartListDetailView(smartListId: string): Promise<void> {
    await this.openPerliteView(PERLITE_SMART_LIST_DETAIL_VIEW_TYPE, { smartListId });
  }

  /** Public: called from `renderInteractiveTaskRow`'s tag-chip click handler — the one
   * path every tag tap, in every lens, goes through. */
  async activateTagDetailView(tag: string): Promise<void> {
    await this.openPerliteView(PERLITE_TAG_DETAIL_VIEW_TYPE, { tag });
  }

  /** The one place any Perlite navigation actually moves a leaf — every `activate*View`
   * method above, plus the smart-list-row and tag-chip click paths, all funnel through
   * here rather than each hand-rolling its own `getLeaf`/`setViewState` call (the
   * inconsistency that let a duplicate tab slip in before: `activateListView`/
   * `activateSmartListsView` used to look up their target leaf by `getLeavesOfType`
   * alone, which stops finding the original leaf the moment it's been repointed to a
   * *different* Perlite view type — so clicking a header "back" action from three levels
   * deep would silently open a second tab instead of reusing the one you were already
   * on).
   *
   * `settings.singleTabNavigation` (on by default) makes every destination reuse
   * `this.perliteLeaf`, re-validated via `isLeafOpen` on every call since the user can
   * close that tab at any time — falling back to `getLeaf(false)` (the most recently
   * active leaf) to (re)establish it, never `getLeaf(true)`, so this mode never opens a
   * tab on its own. With it off, each distinct destination (a view type *and* its state,
   * e.g. each different tag) gets or reuses its own dedicated tab — `leafStateMatches`
   * is what keeps re-tapping the same tag from spawning a second tab for it. */
  async openPerliteView(viewType: string, state?: Record<string, unknown>): Promise<void> {
    if (this.settings.singleTabNavigation) {
      const leaf = this.perliteLeaf !== null && this.isLeafOpen(this.perliteLeaf) ? this.perliteLeaf : this.app.workspace.getLeaf(false);
      this.perliteLeaf = leaf;
      await leaf.setViewState({ type: viewType, active: true, state });
      this.app.workspace.revealLeaf(leaf);
      return;
    }

    const matching = this.app.workspace.getLeavesOfType(viewType).find((leaf) => leafStateMatches(leaf, state));
    const leaf = matching ?? this.app.workspace.getLeaf(true);
    if (matching === undefined) {
      await leaf.setViewState({ type: viewType, active: true, state });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  /** A leaf whose tab has since been closed is simply detached from the workspace's own
   * split tree — `getRoot()` no longer resolves back to `rootSplit` once that's happened,
   * the standard liveness check for a leaf reference held across time (Obsidian has no
   * direct `isOpen`/`isClosed` accessor). */
  private isLeafOpen(leaf: WorkspaceLeaf): boolean {
    return leaf.getRoot() === this.app.workspace.rootSplit;
  }
}

/** Whether `leaf` is already showing the exact destination `state` describes (not just
 * the right view type) — e.g. the smart-list-detail leaf already open for *this*
 * `smartListId`, not some other list. An `undefined` state (views with no identifying
 * state, like the smart lists hub) matches any leaf of the right type. */
function leafStateMatches(leaf: WorkspaceLeaf, state: Record<string, unknown> | undefined): boolean {
  if (state === undefined) return true;
  const current = (leaf.getViewState().state ?? {}) as Record<string, unknown>;
  return Object.entries(state).every(([key, value]) => current[key] === value);
}
