import { Plugin } from "obsidian";

export default class PerlitePlugin extends Plugin {
  async onload(): Promise<void> {
    // Wave 0 bootstrap only — no real functionality yet. See
    // claude-docs/perlite-obsidian-plugin-plan.md (native app repo) for the
    // chunked build order this plugin follows.
  }

  onunload(): void {}
}
