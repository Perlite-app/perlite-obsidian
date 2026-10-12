import { Notice, Plugin, TFile, WorkspaceLeaf, type TAbstractFile } from "obsidian";
import { PERLITE_RIBBON_ICON_ID, registerPerliteIcon } from "./design/brandIcon.js";
import { PERLITE_HOVER_LINK_SOURCE, PERLITE_HOVER_LINK_SOURCE_ID } from "./hoverLinkSource.js";
import { QuickCaptureModal } from "./QuickCaptureModal.js";
import { loadStoredSmartLists, saveStoredSmartLists } from "./SmartListStore.js";
import { EMPTY_STORED_SMART_LISTS, type StoredSmartLists } from "./query/StoredSmartLists.js";
import { PerliteSettingTab } from "./SettingsTab.js";
import { DEFAULT_SETTINGS, DEFAULT_VIEW_SETTINGS, type PerliteSettings } from "./settings.js";
import { createDebouncer, type Debouncer } from "./write/debounce.js";
import { lensCaptureDefaults, type Lens } from "./query/lenses.js";
import type { PerliteMode } from "./settings.js";
import { PERLITE_LENSES_VIEW_TYPE, PerliteLensesView } from "./view/PerliteLensesView.js";
import { PERLITE_LIST_VIEW_TYPE, PerliteListView, todayCounts } from "./view/PerliteListView.js";
import { PERLITE_SMART_LISTS_VIEW_TYPE, PerliteSmartListsView } from "./view/PerliteSmartListsView.js";
import { PerliteState } from "./view/PerliteState.js";
import { PERLITE_TASK_VIEW_TYPE, PerliteTaskView } from "./view/PerliteTaskView.js";

export default class PerlitePlugin extends Plugin {
  settings: PerliteSettings = DEFAULT_SETTINGS;
  smartLists: StoredSmartLists = EMPTY_STORED_SMART_LISTS;
  /** The design pass's shared UI state and vault scan — see `view/PerliteState.ts`. */
  state!: PerliteState;
  private statusBarEl: HTMLElement | null = null;
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
    this.state = new PerliteState(
      this.app,
      () => this.settings,
      () => this.smartLists,
      (view) => {
        this.settings = { ...this.settings, view };
        void this.saveSettings();
      },
    );

    this.registerView(PERLITE_LIST_VIEW_TYPE, (leaf) => new PerliteListView(leaf, this));
    this.registerView(PERLITE_LENSES_VIEW_TYPE, (leaf) => new PerliteLensesView(leaf, this));
    this.registerView(PERLITE_TASK_VIEW_TYPE, (leaf) => new PerliteTaskView(leaf, this));
    this.registerView(PERLITE_SMART_LISTS_VIEW_TYPE, (leaf) => new PerliteSmartListsView(leaf, this));

    // Desktop-only status bar item (Obsidian has no status bar on mobile): what's left
    // today; click to open Today.
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("perlite-status-bar", "mod-clickable");
    this.statusBarEl.addEventListener("click", () => void this.openLens({ kind: "today" }));
    this.registerEvent(this.state.on("data", () => this.updateStatusBar()));
    this.app.workspace.onLayoutReady(() => void this.state.rescan());
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

    // Id kept from the old "Quick capture" command so an existing hotkey still works;
    // no default hotkey, per the community plugin guidelines.
    this.addCommand({
      id: "quick-capture",
      name: "New task",
      callback: () => this.openQuickAdd(),
    });
    this.addCommand({ id: "show-lenses", name: "Show lenses sidebar", callback: () => void this.revealLensesSidebar() });
    this.addCommand({ id: "show-task", name: "Show task sidebar", callback: () => void this.revealTaskSidebar() });
    for (const [mode, label] of [
      ["list", "List"],
      ["board", "Board"],
      ["calendar", "Calendar"],
    ] as const) {
      this.addCommand({ id: `show-${mode}`, name: `Show as ${label.toLowerCase()}`, callback: () => void this.openMode(mode) });
    }

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
    return listView !== null && this.state.view.mode === "list" ? listView.keyboardNav : null;
  }

  onunload(): void {
    this.scheduleVaultRefresh.cancel();
  }

  private async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<PerliteSettings> | null;
    // `view` is merged field by field so a settings file from before a view option
    // existed still gets that option's default.
    this.settings = { ...DEFAULT_SETTINGS, ...stored, view: { ...DEFAULT_VIEW_SETTINGS, ...stored?.view } };
  }

  private updateStatusBar(): void {
    if (this.statusBarEl === null) return;
    const { open } = todayCounts(this.state.located);
    this.statusBarEl.setText(open === 0 ? "Perlite: today is clear" : `Perlite: ${open} left today`);
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

  /** Rescans the vault once into the shared state (every Perlite view re-renders from
   * its `"data"` event) and refreshes the smart-list hub, which reads its own counts.
   * Called after every write and on vault changes. */
  async refreshAllViews(): Promise<void> {
    await this.state.rescan();
    for (const leaf of this.app.workspace.getLeavesOfType(PERLITE_SMART_LISTS_VIEW_TYPE)) {
      if (leaf.view instanceof PerliteSmartListsView) await leaf.view.refresh();
    }
  }

  /** The ribbon icon and "Open task list": the main tab, plus the two sidebar views the
   * design places beside it, created once if they aren't in the workspace yet. */
  async activateListView(): Promise<void> {
    await this.openPerliteView(PERLITE_LIST_VIEW_TYPE);
    await this.ensureSidebarView(PERLITE_LENSES_VIEW_TYPE, "left");
    await this.ensureSidebarView(PERLITE_TASK_VIEW_TYPE, "right");
  }

  async activateSmartListsView(): Promise<void> {
    await this.openPerliteView(PERLITE_SMART_LISTS_VIEW_TYPE);
  }

  /** Switches the main tab to `lens` (and optionally a mode) and shows it. The smart
   * list hub, the lenses sidebar and the status bar all navigate through here. */
  async openLens(lens: Lens, mode?: PerliteMode): Promise<void> {
    this.state.setLens(lens);
    if (mode !== undefined) this.state.updateView({ mode });
    await this.activateListView();
  }

  async openMode(mode: PerliteMode): Promise<void> {
    this.state.updateView({ mode });
    await this.activateListView();
  }

  /** Kept for the smart-list hub: a list opens as a lens of the main tab, in the layout
   * its own `lens` setting asks for. */
  async activateSmartListDetailView(smartListId: string): Promise<void> {
    const list = this.state.smartLists.find((candidate) => candidate.id === smartListId);
    const mode: PerliteMode | undefined = list?.lens === "kanban" ? "board" : list?.lens === "calendar" ? "calendar" : list?.lens === "list" ? "list" : undefined;
    await this.openLens({ kind: "list", id: smartListId }, mode);
  }

  async activateTagDetailView(tag: string): Promise<void> {
    await this.openLens({ kind: "tag", tag: tag.toLowerCase() });
  }

  /** Quick add, pre-filled with the current lens's defaults (Today → due today, …). */
  openQuickAdd(initialText = ""): void {
    new QuickCaptureModal(this.app, this, { defaults: lensCaptureDefaults(this.state.lens), initialText }).open();
  }

  async revealLensesSidebar(): Promise<void> {
    const leaf = await this.ensureSidebarView(PERLITE_LENSES_VIEW_TYPE, "left");
    if (leaf !== null) this.app.workspace.revealLeaf(leaf);
  }

  async revealTaskSidebar(): Promise<void> {
    const leaf = await this.ensureSidebarView(PERLITE_TASK_VIEW_TYPE, "right");
    if (leaf !== null) this.app.workspace.revealLeaf(leaf);
  }

  private async ensureSidebarView(viewType: string, side: "left" | "right"): Promise<WorkspaceLeaf | null> {
    const existing = this.app.workspace.getLeavesOfType(viewType)[0];
    if (existing !== undefined) return existing;
    const leaf = side === "left" ? this.app.workspace.getLeftLeaf(false) : this.app.workspace.getRightLeaf(false);
    if (leaf === null) return null;
    await leaf.setViewState({ type: viewType, active: false });
    return leaf;
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
