import { App, Modal, Setting } from "obsidian";

/**
 * The `T` keyboard action (Wave 2 chunk 11) — a minimal single-field prompt, not a
 * `FuzzySuggestModal` (there's nothing to pick from: adding a tag is free-text entry,
 * not a choice among existing options), and not a full tag-management screen — one
 * keystroke action adding one tag is a deliberately narrow initial scope, same
 * reasoning `RescheduleModal`'s own doc comment gives for its fixed option set.
 */
export class AddTagModal extends Modal {
  private readonly onSubmit: (tag: string) => void;
  private value = "#";

  constructor(app: App, onSubmit: (tag: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Add tag" });

    let inputEl: HTMLInputElement | null = null;
    new Setting(contentEl).setName("Tag").addText((text) => {
      text.setValue(this.value).onChange((value) => {
        this.value = value;
      });
      inputEl = text.inputEl;
      inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.submit();
        }
      });
    });

    new Setting(contentEl).addButton((button) => button.setButtonText("Add").setCta().onClick(() => this.submit()));

    window.setTimeout(() => inputEl?.focus(), 0);
  }

  private submit(): void {
    const trimmed = this.value.trim();
    if (trimmed.length <= 1) {
      this.close();
      return;
    }
    this.onSubmit(trimmed);
    this.close();
  }
}
