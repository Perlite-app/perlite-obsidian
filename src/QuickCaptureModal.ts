import { AbstractInputSuggest, App, FuzzySuggestModal, Modal, Notice, Platform, setIcon, type TFile } from "obsidian";
import { buildQuickAddTaskLine, quickAddSpans, type QuickAddResult } from "./capture/QuickAddParser.js";
import { relativeDayLabel } from "./design/relativeDay.js";
import { calendarDateToISOString } from "./model/CalendarDate.js";
import { allTags } from "./model/ParsedTask.js";
import { priorityTitle, splitNotePath, type LensCaptureDefaults } from "./query/lenses.js";
import { parserConfiguration } from "./settings.js";
import { todayCalendarDate } from "./support/today.js";
import { appendQuickAddTask } from "./write/appendQuickAddTask.js";
import { parseDocument, type DocumentHeading } from "./parser/DocumentParser.js";
import { parseWithDefaults, previewLine, renderCaptureField, type CaptureField } from "./view/main/captureField.js";
import type PerlitePlugin from "./main.js";

/**
 * The Quick add modal (design pass, "Plugin · Quick add"): an Obsidian `Modal` — centred
 * on desktop, full-screen on mobile, title and × from the host. One large capture field
 * with every recognised phrase tinted in place; `#` opens a tag suggestion popover
 * (`AbstractInputSuggest`) anchored to the field; each recognised value is a removable
 * chip; the Due / Priority / Repeat / Save to summary; and the exact line that will be
 * appended. Enter adds and keeps the modal open for the next task, Mod+Enter adds and
 * closes. Registered as a command with no default hotkey (community plugin guideline).
 *
 * The destination is a "Save to" picker, not `@note` syntax — `@` is a person mention
 * in the native app, and the capture syntax is kept the same on every Perlite surface.
 */
export class QuickCaptureModal extends Modal {
  private readonly plugin: PerlitePlugin;
  private readonly defaults: LensCaptureDefaults | null;
  private destination: string;
  /** Under this heading of `destination`, or at the end when null. Chosen with the note. */
  private heading: DocumentHeading | null = null;
  private field: CaptureField | null = null;
  private suggest: TagSuggest | null = null;
  private chipsEl: HTMLElement | null = null;
  private propsEl: HTMLElement | null = null;
  private previewEl: HTMLElement | null = null;
  private noticeEl: HTMLElement | null = null;
  private addButton: HTMLButtonElement | null = null;
  private initialText: string;

  constructor(app: App, plugin: PerlitePlugin, options: { readonly defaults?: LensCaptureDefaults | null; readonly initialText?: string } = {}) {
    super(app);
    this.plugin = plugin;
    this.defaults = options.defaults ?? null;
    this.destination = this.defaults?.destination ?? plugin.settings.defaultInboxFile;
    this.initialText = options.initialText ?? "";
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("perlite-quickadd");
    this.setTitle("New task");

    this.field = renderCaptureField(contentEl, {
      placeholder: "What needs doing?",
      label: "Task, with dates, priority, repeat and tags in plain words",
      initial: this.initialText,
      large: true,
      onChange: () => this.update(),
      onKeyDown: (event) => this.onKey(event),
    });
    this.suggest = new TagSuggest(this.app, this.plugin, this.field);

    this.chipsEl = contentEl.createDiv({ cls: "perlite-quickadd__chips" });
    this.propsEl = contentEl.createDiv({ cls: "perlite-quickadd__props" });
    this.previewEl = contentEl.createDiv({ cls: "perlite-quickadd__preview" });

    const footer = contentEl.createDiv({ cls: "perlite-quickadd__footer" });
    const help = footer.createDiv({ cls: "prompt-instructions" });
    this.noticeEl = help.createSpan({ cls: "perlite-quickadd__notice", attr: { role: "status" } });
    for (const [key, text] of [
      ["↵", "add"],
      [Platform.isMacOS ? "⌘ ↵" : "ctrl ↵", "add and close"],
      ["tab", "accept suggestion"],
    ] as const) {
      const instruction = help.createDiv({ cls: "prompt-instruction" });
      instruction.createSpan({ cls: "prompt-instruction-command", text: key });
      instruction.createSpan({ text });
    }
    const buttons = footer.createDiv({ cls: "modal-button-container" });
    const cancel = buttons.createEl("button", { text: "Cancel", attr: { type: "button" } });
    cancel.addEventListener("click", () => this.close());
    this.addButton = buttons.createEl("button", { cls: "mod-cta", text: "Add task", attr: { type: "button" } });
    this.addButton.addEventListener("click", () => void this.add(false));

    this.update();
    window.setTimeout(() => this.field?.focus(), 0);
  }

  onClose(): void {
    this.suggest?.close();
    this.contentEl.empty();
  }

  private onKey(event: KeyboardEvent): void {
    if (event.isComposing || event.key !== "Enter") return;
    if (this.suggest?.isOpen === true && !(event.metaKey || event.ctrlKey)) return; // the popover takes Enter
    event.preventDefault();
    void this.add(event.metaKey || event.ctrlKey);
  }

  private result(): QuickAddResult {
    return parseWithDefaults(this.field?.value() ?? "", this.defaults, todayCalendarDate());
  }

  private update(): void {
    const text = this.field?.value() ?? "";
    const result = this.result();
    const today = todayCalendarDate();
    this.noticeEl?.empty();

    // Chips: one per recognised phrase; removing one takes it out of the text.
    const chips = this.chipsEl!;
    chips.empty();
    const spans = quickAddSpans(text);
    if (spans.length === 0) {
      const hint = chips.createSpan({ cls: "perlite-quickadd__hint" });
      hint.appendText("Try ");
      ["tomorrow", "!!", "every week", "#tag"].forEach((example, index) => {
        if (index > 0) hint.appendText(", ");
        hint.createEl("code", { text: example });
      });
    }
    for (const span of spans) {
      const phrase = text.slice(span.start, span.end);
      const label =
        span.kind === "date" && result.dueDate !== null
          ? relativeDayLabel(result.dueDate, today)
          : span.kind === "priority" && result.priority !== null
            ? priorityTitle(result.priority)
            : span.kind === "recurrence" && result.recurrenceRule !== null
              ? capitalize(result.recurrenceRule)
              : phrase;
      const chip = chips.createEl("button", { cls: `perlite-chip perlite-token--${span.kind}`, attr: { type: "button", "aria-label": `Remove ${label}` } });
      setIcon(chip.createSpan(), span.kind === "date" ? "calendar" : span.kind === "priority" ? "flag" : span.kind === "recurrence" ? "repeat" : "hash");
      chip.createSpan({ text: label });
      setIcon(chip.createSpan({ cls: "perlite-chip__x" }), "x");
      chip.addEventListener("click", () => {
        const next = (text.slice(0, span.start) + text.slice(span.end)).replace(/ {2,}/g, " ").replace(/^\s+/, "");
        this.field?.setValue(next);
        this.field?.focus();
      });
    }

    // Summary tiles.
    const props = this.propsEl!;
    props.empty();
    const tile = (name: string, icon: string, tone: string, value: string, empty: boolean, onClick?: () => void): void => {
      const el = props.createEl(onClick !== undefined ? "button" : "div", { cls: "perlite-field", attr: onClick !== undefined ? { type: "button" } : {} });
      el.toggleClass("is-empty", empty);
      const t = el.createSpan({ cls: "perlite-field__tile" });
      t.dataset.tone = tone;
      setIcon(t, icon);
      const textEl = el.createSpan({ cls: "perlite-field__text" });
      textEl.createSpan({ cls: "perlite-field__name", text: name });
      textEl.createSpan({ cls: "perlite-field__value", text: value });
      if (onClick !== undefined) el.addEventListener("click", onClick);
    };
    tile("Due", "calendar", "red", result.dueDate !== null ? `${relativeDayLabel(result.dueDate, today)} · ${calendarDateToISOString(result.dueDate)}` : "No date", result.dueDate === null);
    tile("Priority", "flag", "orange", result.priority !== null && result.priority !== "normal" ? priorityTitle(result.priority) : "None", result.priority === null);
    tile("Repeat", "repeat", "cyan", result.recurrenceRule !== null ? capitalize(result.recurrenceRule) : "Never", result.recurrenceRule === null);
    tile("Save to", "file", "purple", this.heading === null ? this.destination : `${this.destination} › ${this.heading.text}`, false, () =>
      new NotePicker(this.app, (file) => void this.pickPlaceIn(file)).open(),
    );

    // The exact line.
    const preview = this.previewEl!;
    preview.empty();
    const head = preview.createDiv({ cls: "perlite-quickadd__appends" });
    if (this.heading === null) {
      head.appendText("Appends to ");
      head.createSpan({ cls: "perlite-quickadd__dest", text: this.destination });
    } else {
      head.appendText("Adds under ");
      head.createSpan({ cls: "perlite-quickadd__dest", text: `${"#".repeat(this.heading.level)} ${this.heading.text}` });
      head.appendText(" in ");
      head.createSpan({ cls: "perlite-quickadd__dest", text: this.destination });
    }
    preview.createEl("code", { text: previewLine(result, this.plugin.settings, today) ?? "- [ ] …" });

    const canAdd = result.description.trim().length > 0;
    if (this.addButton !== null) this.addButton.disabled = !canAdd;
  }

  /** After a note is picked: where in it. A note with headings offers "End of note"
   * and each heading (Perlite's own heading rules, the ones `insertEdit` finds them by). */
  private async pickPlaceIn(file: TFile): Promise<void> {
    const headings = parseDocument(await this.app.vault.cachedRead(file), file.path).headings;
    const choose = (heading: DocumentHeading | null): void => {
      this.destination = file.path;
      this.heading = heading;
      this.update();
    };
    if (headings.length === 0) choose(null);
    else new HeadingPicker(this.app, file.basename, headings, choose).open();
  }

  private async add(close: boolean): Promise<void> {
    const result = this.result();
    if (result.description.trim().length === 0) return;
    const task = buildQuickAddTaskLine(result, todayCalendarDate(), parserConfiguration(this.plugin.settings));
    const added = await appendQuickAddTask(this.app, task, this.destination, this.heading);
    if (!added) return;
    await this.plugin.refreshAllViews();
    if (close) {
      new Notice(`Added to ${splitNotePath(this.destination).note}`);
      this.close();
      return;
    }
    this.field?.setValue("");
    this.field?.focus();
    this.noticeEl?.setText(`Added to ${splitNotePath(this.destination).note}`);
  }
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

/** The `#tag` popover: the tag being typed at the end of the field, matched against the
 * vault's tags (most-used first), plus "Create #…" for a new one. Tab or Enter accepts. */
class TagSuggest extends AbstractInputSuggest<{ readonly tag: string; readonly count: number; readonly isNew: boolean }> {
  isOpen = false;

  constructor(
    app: App,
    private readonly plugin: PerlitePlugin,
    private readonly field: CaptureField,
  ) {
    // `AbstractInputSuggest` takes an input or a contenteditable; the capture field is
    // a textarea, so `getValue`/`setValue` below read and write it directly.
    super(app, field.inputEl as unknown as HTMLInputElement);
    this.limit = 8;
    this.scope.register([], "Tab", (event) => {
      event.preventDefault();
      // Same path as Enter: PopoverSuggest's own key handling selects the highlighted item.
      (this as unknown as { suggestions?: { useSelectedItem?: (evt: KeyboardEvent) => void } }).suggestions?.useSelectedItem?.(event);
      return false;
    });
  }

  getValue(): string {
    return this.field.inputEl.value;
  }

  setValue(value: string): void {
    this.field.setValue(value);
  }

  open(): void {
    super.open();
    this.isOpen = true;
  }

  close(): void {
    super.close();
    this.isOpen = false;
  }

  protected getSuggestions(): { tag: string; count: number; isNew: boolean }[] {
    const value = this.getValue();
    const caret = this.field.inputEl.selectionStart ?? value.length;
    const fragment = /(?:^|\s)#([\p{L}\p{N}_/-]*)$/u.exec(value.slice(0, caret));
    if (fragment === null) return [];
    const query = fragment[1]!.toLowerCase();
    const counts = new Map<string, number>();
    for (const entry of this.plugin.state.located) {
      for (const tag of allTags(entry.task)) {
        const key = tag.raw.toLowerCase();
        if (key === this.plugin.settings.globalFilterTag.toLowerCase()) continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    const matches = [...counts]
      .filter(([tag]) => tag.slice(1).includes(query))
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count, isNew: false }));
    if (query.length > 0 && !counts.has(`#${query}`)) matches.push({ tag: `#${fragment[1]!}`, count: 0, isNew: true });
    return matches;
  }

  renderSuggestion(value: { tag: string; count: number; isNew: boolean }, el: HTMLElement): void {
    el.addClass("perlite-suggestion");
    setIcon(el.createSpan({ cls: "perlite-suggestion__icon" }), value.isNew ? "plus" : "hash");
    el.createSpan({ cls: "perlite-suggestion__label", text: value.isNew ? `Create ${value.tag}` : value.tag.slice(1) });
    if (!value.isNew) el.createSpan({ cls: "perlite-suggestion__meta", text: `${value.count}` });
  }

  selectSuggestion(value: { tag: string; count: number; isNew: boolean }): void {
    const input = this.field.inputEl;
    const text = input.value;
    const caret = input.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/#[\p{L}\p{N}_/-]*$/u, `${value.tag} `);
    this.field.setValue(before + text.slice(caret));
    input.setSelectionRange(before.length, before.length);
    this.close();
  }
}

/** "Save to": any markdown note in the vault, most recently modified first. */
class NotePicker extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly onPick: (file: TFile) => void,
  ) {
    super(app);
    this.setPlaceholder("Save the task to…");
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles().sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onPick(file);
  }
}

/** "Save to", second step: the end of the note or one of its headings, in note order. */
class HeadingPicker extends FuzzySuggestModal<DocumentHeading | null> {
  constructor(
    app: App,
    noteName: string,
    private readonly headings: readonly DocumentHeading[],
    private readonly onPick: (heading: DocumentHeading | null) => void,
  ) {
    super(app);
    this.setPlaceholder(`Where in ${noteName}?`);
  }

  getItems(): (DocumentHeading | null)[] {
    return [null, ...this.headings];
  }

  getItemText(heading: DocumentHeading | null): string {
    return heading === null ? "End of note" : `${"#".repeat(heading.level)} ${heading.text}`;
  }

  onChooseItem(heading: DocumentHeading | null): void {
    this.onPick(heading);
  }
}
