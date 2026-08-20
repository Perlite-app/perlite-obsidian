import { App, Modal, Notice, Setting } from "obsidian";
import { buildQuickAddTaskLine, parseQuickAdd } from "./capture/QuickAddParser.js";
import { calendarDateToISOString } from "./model/CalendarDate.js";
import { clockTimeToISOString } from "./model/ClockTime.js";
import { parserConfiguration } from "./settings.js";
import { todayCalendarDate } from "./support/today.js";
import { appendQuickAddTask } from "./write/appendQuickAddTask.js";
import type PerlitePlugin from "./main.js";

/**
 * Wave 2 chunk 13's quick-capture command — a minimal free-text input, deterministic
 * Tier-1-equivalent parsing (`capture/QuickAddParser.ts`) shown live as a one-line
 * preview of what was recognised, Enter (or the Add button) to commit. Appends to
 * `settings.defaultInboxFile` via `appendQuickAddTask`. Deliberately no dismissible
 * per-field chips like the native app's own Quick Add screen — a modal is a much
 * smaller surface than a dedicated sheet, and "type the phrase differently to change
 * what's recognised" is a reasonable initial scope for a command-palette-launched
 * capture box.
 */
export class QuickCaptureModal extends Modal {
  private readonly plugin: PerlitePlugin;
  private text = "";
  private previewEl: HTMLElement | null = null;

  constructor(app: App, plugin: PerlitePlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Quick capture" });

    let inputEl: HTMLTextAreaElement | null = null;
    new Setting(contentEl).addTextArea((textArea) => {
      textArea.inputEl.rows = 2;
      textArea.inputEl.addClass("perlite-quickadd-input");
      textArea.setPlaceholder("Buy milk tomorrow !high #errands");
      textArea.onChange((value) => {
        this.text = value;
        this.updatePreview();
      });
      inputEl = textArea.inputEl;
      inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          void this.submit();
        }
      });
    });

    this.previewEl = contentEl.createDiv({ cls: "perlite-quickadd-preview" });

    new Setting(contentEl).addButton((button) => button.setButtonText("Add").setCta().onClick(() => void this.submit()));

    window.setTimeout(() => inputEl?.focus(), 0);
  }

  private updatePreview(): void {
    const el = this.previewEl;
    if (el === null) return;
    el.empty();
    if (this.text.trim().length === 0) return;

    const result = parseQuickAdd(this.text);
    const parts: string[] = [];
    if (result.dueDate !== null) parts.push(`📅 ${calendarDateToISOString(result.dueDate)}`);
    if (result.reminder !== null && result.reminder.time !== null) {
      parts.push(`⏰ ${clockTimeToISOString(result.reminder.time)}`);
    }
    if (result.priority !== null) parts.push(`Priority: ${result.priority}`);
    if (parts.length === 0) return;
    el.setText(parts.join("   "));
  }

  private async submit(): Promise<void> {
    const trimmed = this.text.trim();
    if (trimmed.length === 0) {
      this.close();
      return;
    }

    const result = parseQuickAdd(trimmed);
    const configuration = parserConfiguration(this.plugin.settings);
    const task = buildQuickAddTaskLine(result, todayCalendarDate(), configuration);
    const succeeded = await appendQuickAddTask(this.app, task, this.plugin.settings.defaultInboxFile);
    if (succeeded) {
      new Notice(`Added to ${this.plugin.settings.defaultInboxFile}`);
      await this.plugin.refreshAllViews();
    }
    this.close();
  }
}
