import type { HoverLinkSource } from "obsidian";

/**
 * Wave 2 chunk 12's inline context hover — the native `hover-link` workspace event,
 * registered once via `Plugin.registerHoverLinkSource` (`main.ts`'s `onload`) so this
 * plugin shows up in the core "Page preview" plugin's own settings exactly like any
 * other hover-link source (the Backlinks pane, the core Outgoing Links view, …), with
 * its "requires the Mod key" toggle under the user's own control — this plugin never
 * decides that itself, only whether to *offer* a preview at all, per the plan's own
 * "respecting the user's own Page Preview settings" instruction.
 */
export const PERLITE_HOVER_LINK_SOURCE_ID = "perlite";

export const PERLITE_HOVER_LINK_SOURCE: HoverLinkSource = {
  display: "Perlite",
  defaultMod: true,
};
