import { Scope, TFile, type App, type ItemView } from "obsidian";
import { computeSourceContext } from "../design/taskLineModel.js";
import type { ParsedTask } from "../model/ParsedTask.js";
import { AddTagModal } from "../AddTagModal.js";
import { RescheduleModal } from "../RescheduleModal.js";
import * as TaskSerializer from "../parser/TaskSerializer.js";
import { parserConfiguration } from "../settings.js";
import { createTaskTag } from "../model/TaskTag.js";
import { editTaskField } from "../write/editTaskField.js";
import { completeTaskAndWrite, openTaskInEditor } from "./taskRowInteractions.js";
import type PerlitePlugin from "../main.js";

/**
 * Wave 2 chunk 11's keyboard-first triage — `J`/`K`/arrows to move selection,
 * `Shift+Space` to expand inline context, `C` complete, `D` reschedule (a
 * `FuzzySuggestModal` palette, not a custom widget), `T` add a tag, `Enter` open the
 * source note. Bound through a view-scoped `Scope` (`view.scope = new
 * Scope(app.scope)`, Obsidian's own documented mechanism — active only while the view
 * has focus), never global hotkeys. Every action is *also* registered via
 * `Plugin.addCommand`'s `checkCallback` (wired by the owning view, see
 * `PerliteListView`), so Obsidian's own Hotkeys settings can rebind or view the
 * bindings — the `Scope` registration here is what makes the bare, unmodified letter
 * actually fire without needing a modifier key, which `addCommand` alone can't offer
 * for single-letter, no-modifier bindings.
 *
 * One reusable controller shared by every row-list view (`PerliteListView`,
 * `PerliteSmartListDetailView`) rather than a second, divergent copy — selection is
 * index-based (this plugin has no stable cross-refresh task identity yet, unlike the
 * native app's later `TaskStableID`; out of this chunk's scope), so a refresh keeps the
 * same *position* selected, not necessarily the same task.
 */

export interface KeyboardNavRow {
  readonly task: ParsedTask;
  readonly file: TFile;
  readonly rowEl: HTMLElement;
}

const ROW_ID_PREFIX = "perlite-kbnav-row-";

export class ListKeyboardNav {
  private readonly app: App;
  private readonly plugin: PerlitePlugin;
  private readonly view: ItemView;
  private readonly onAfterWrite: () => void | Promise<void>;

  private rows: KeyboardNavRow[] = [];
  private selectedIndex: number | null = null;
  private expandedIndex: number | null = null;
  private expansionEl: HTMLElement | null = null;
  private liveRegion: HTMLElement | null = null;
  private listboxEl: HTMLElement | null = null;

  constructor(view: ItemView, app: App, plugin: PerlitePlugin, onAfterWrite: () => void | Promise<void>) {
    this.view = view;
    this.app = app;
    this.plugin = plugin;
    this.onAfterWrite = onAfterWrite;
  }

  /** Call once, after the view's container exists — assigns `view.scope`, which is
   * what activates these bindings only while this view has focus. */
  attach(listboxEl: HTMLElement, liveRegion: HTMLElement): void {
    this.listboxEl = listboxEl;
    this.listboxEl.setAttribute("role", "listbox");
    this.liveRegion = liveRegion;
    this.view.scope = new Scope(this.app.scope);
    const scope = this.view.scope;
    scope.register([], "j", () => this.guarded(() => this.moveSelection(1)));
    scope.register([], "ArrowDown", () => this.guarded(() => this.moveSelection(1)));
    scope.register([], "k", () => this.guarded(() => this.moveSelection(-1)));
    scope.register([], "ArrowUp", () => this.guarded(() => this.moveSelection(-1)));
    scope.register([], "Enter", () => this.guarded(() => void this.openSelected()));
    scope.register([], "c", () => this.guarded(() => void this.completeSelected()));
    scope.register([], "d", () => this.guarded(() => this.rescheduleSelected()));
    scope.register([], "t", () => this.guarded(() => this.tagSelected()));
    scope.register(["Shift"], " ", () => this.guarded(() => this.toggleExpanded()));
  }

  /** Every rendering pass calls this with the rows it just built, in display order —
   * wires each row's `id`/`role`/`tabindex` for the composite-listbox accessibility
   * pattern and keeps the previous selection's *index* if it's still in range. */
  setRows(rows: readonly KeyboardNavRow[]): void {
    this.rows = [...rows];
    this.expansionEl = null;
    this.expandedIndex = null;
    this.rows.forEach((row, index) => {
      row.rowEl.id = `${ROW_ID_PREFIX}${index}`;
      row.rowEl.setAttribute("role", "option");
      row.rowEl.setAttribute("tabindex", "-1");
      row.rowEl.setAttribute("aria-selected", "false");
    });
    if (this.selectedIndex !== null && this.selectedIndex >= this.rows.length) {
      this.selectedIndex = this.rows.length > 0 ? this.rows.length - 1 : null;
    }
    this.applySelectionStyling(false);
  }

  /** Suppresses single-key handling while any text input/contenteditable has focus —
   * required so this plugin's own modals (which reuse the same `App`, not a separate
   * one) and any other plugin's text field never lose keystrokes to these bindings. */
  private guarded(action: () => void): false | void {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable)) {
      return; // let the keystroke reach the field normally
    }
    action();
    return false;
  }

  moveSelection(delta: number): void {
    if (this.rows.length === 0) return;
    const next = this.selectedIndex === null ? (delta > 0 ? 0 : this.rows.length - 1) : clamp(this.selectedIndex + delta, 0, this.rows.length - 1);
    this.selectedIndex = next;
    this.applySelectionStyling(true);
  }

  private applySelectionStyling(scrollAndAnnounce: boolean): void {
    this.rows.forEach((row, index) => {
      const selected = index === this.selectedIndex;
      row.rowEl.toggleClass("perlite-row--selected", selected);
      row.rowEl.setAttribute("aria-selected", selected ? "true" : "false");
    });
    if (this.listboxEl !== null) {
      const selectedRow = this.selectedIndex !== null ? this.rows[this.selectedIndex] : undefined;
      if (selectedRow !== undefined) {
        this.listboxEl.setAttribute("aria-activedescendant", selectedRow.rowEl.id);
      } else {
        this.listboxEl.removeAttribute("aria-activedescendant");
      }
    }
    if (!scrollAndAnnounce) return;
    const selectedRow = this.selectedIndex !== null ? this.rows[this.selectedIndex] : undefined;
    if (selectedRow === undefined) return;
    selectedRow.rowEl.scrollIntoView({ block: "nearest" });
    if (this.liveRegion !== null) this.liveRegion.setText(selectedRow.task.description || "(no description)");
  }

  private selected(): KeyboardNavRow | null {
    return this.selectedIndex !== null ? (this.rows[this.selectedIndex] ?? null) : null;
  }

  async openSelected(): Promise<void> {
    const row = this.selected();
    if (row === null) return;
    await openTaskInEditor(this.app, row.task, row.file);
  }

  async completeSelected(): Promise<void> {
    const row = this.selected();
    if (row === null) return;
    await completeTaskAndWrite(this.app, this.plugin, row.task, row.file);
    await this.onAfterWrite();
  }

  rescheduleSelected(): void {
    const row = this.selected();
    if (row === null) return;
    new RescheduleModal(this.app, (date) => {
      void (async () => {
        const configuration = parserConfiguration(this.plugin.settings);
        await editTaskField(this.app, row.file, row.task, (task) => TaskSerializer.setDate(task, "due", date, configuration));
        await this.onAfterWrite();
      })();
    }).open();
  }

  tagSelected(): void {
    const row = this.selected();
    if (row === null) return;
    new AddTagModal(this.app, (tagText) => {
      void (async () => {
        const configuration = parserConfiguration(this.plugin.settings);
        await editTaskField(this.app, row.file, row.task, (task) => TaskSerializer.addTag(task, createTaskTag(tagText), configuration));
        await this.onAfterWrite();
      })();
    }).open();
  }

  toggleExpanded(): void {
    const row = this.selected();
    if (row === null) return;
    if (this.expandedIndex === this.selectedIndex) {
      this.expansionEl?.remove();
      this.expansionEl = null;
      this.expandedIndex = null;
      return;
    }
    this.expansionEl?.remove();
    this.expandedIndex = this.selectedIndex;
    const context = computeSourceContext(row.task);
    const el = document.createElement("div");
    el.addClass("perlite-row-expansion");
    if (context !== null) el.createDiv({ text: context });
    if (row.task.recurrenceRule !== null) el.createDiv({ text: `Repeats: ${row.task.recurrenceRule}` });
    el.createEl("code", { text: row.task.raw, cls: "perlite-row-expansion__raw" });
    row.rowEl.insertAdjacentElement("afterend", el);
    this.expansionEl = el;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
