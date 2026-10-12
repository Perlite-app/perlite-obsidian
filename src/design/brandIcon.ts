import { addIcon } from "obsidian";

/** Icon id passed to `addRibbonIcon`/`setIcon` for the Perlite mark, once registered. */
export const PERLITE_RIBBON_ICON_ID = "perlite-logo";

/** The Perlite faceted-gem mark, reduced from the multi-color fill polygons in
 * perlite-web's `Logo.astro` to a monochrome `currentColor` outline in Lucide's 24x24/
 * stroke-2 style — so it sits in the ribbon like Obsidian's own icons and follows the
 * active theme instead of hard-coding the marketing site's fill palette. Facet lines are
 * the exact edge set of the original polygon mesh (outer octagon, inner diamond, and the
 * 8 spokes joining them), just traced instead of filled. */
const PERLITE_LOGO_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M2.4 9.2 L6.8 3.2 L15.2 2 L20 6.8 L21.6 13.2 L17.2 20.4 L9.2 21.6 L3.6 16.8 Z" />
  <path d="M11.6 8 L17.2 11.6 L11.6 16.4 L6.4 11.6 Z" />
  <path d="M6.8 3.2 L11.6 8 M15.2 2 L11.6 8 M20 6.8 L17.2 11.6 M21.6 13.2 L17.2 11.6 M17.2 20.4 L11.6 16.4 M9.2 21.6 L11.6 16.4 M3.6 16.8 L6.4 11.6 M2.4 9.2 L6.4 11.6" />
</svg>`;

/** Registers the Perlite mark as a custom Obsidian icon under `PERLITE_RIBBON_ICON_ID`.
 * Safe to call on every `onload` — `addIcon` just re-registers the same id. */
export function registerPerliteIcon(): void {
  addIcon(PERLITE_RIBBON_ICON_ID, PERLITE_LOGO_SVG);
}
