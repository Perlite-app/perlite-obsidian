import { App, PluginSettingTab, Setting } from "obsidian";
import type PerlitePlugin from "./main.js";

/**
 * Wave 1 chunk 9's settings tab — global filter toggle + tag, folder exclusions. See
 * `settings.ts`'s own doc comment for why the scope stops there for now.
 */
export class PerliteSettingTab extends PluginSettingTab {
  private readonly plugin: PerlitePlugin;

  constructor(app: App, plugin: PerlitePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Global filter")
      .setDesc(
        "Only checkbox lines containing this tag are treated as tasks. Turning this " +
          "off surfaces every checkbox in the vault, including ones never meant as tasks.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.globalFilterEnabled).onChange(async (value) => {
          await this.plugin.updateSettings({ globalFilterEnabled: value });
        }),
      );

    new Setting(containerEl)
      .setName("Global filter tag")
      .setDesc("The tag a checkbox line must contain to count as a task.")
      .addText((text) =>
        text
          .setPlaceholder("#task")
          .setValue(this.plugin.settings.globalFilterTag)
          .onChange(async (value) => {
            const trimmed = value.trim();
            if (trimmed.length === 0) return;
            await this.plugin.updateSettings({ globalFilterTag: trimmed });
          }),
      );

    new Setting(containerEl)
      .setName("Excluded folders")
      .setDesc("Vault-relative folder paths to skip entirely, one per line.")
      .addTextArea((text) => {
        text.inputEl.rows = 4;
        text
          .setPlaceholder("Archive\nTemplates")
          .setValue(this.plugin.settings.excludedFolders.join("\n"))
          .onChange(async (value) => {
            const folders = value
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 0);
            await this.plugin.updateSettings({ excludedFolders: folders });
          });
      });
  }
}
