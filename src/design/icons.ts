import { setIcon } from "obsidian";

/**
 * Every Lucide icon this design system uses, as a closed set of real Lucide kebab-case
 * names. Obsidian ships Lucide internally and renders any of its icons directly via
 * `setIcon(el, name)` — unlike the native app, which had to `curl` raw SVGs from
 * `lucide-icons/lucide` and hand-write an SVG path parser
 * (`SVGPath.swift`/`LucideIcon.swift`) because iOS has no built-in Lucide renderer, there
 * is no icon-sourcing step here at all. Names are transcribed verbatim from
 * `Perlite/DesignSystem/LucideIcon.swift`'s own `kebabName` mapping — the same visual
 * roles, not a redesign.
 */
export type PerliteIconName =
  | "circle" // status: todo
  | "circle-check" // status: done; also the subtask-progress chip
  | "circle-x" // status: cancelled
  | "circle-question-mark" // status: custom
  | "calendar" // due-date chip
  | "flag" // priority chip
  | "repeat" // recurrence indicator (icon only, no text)
  | "corner-down-right"; // parent-task breadcrumb

/** Thin wrapper over Obsidian's `setIcon` — the one place this codebase calls it, so a
 * future icon-rendering change (e.g. caching) has one call site to touch. */
export function renderIcon(container: HTMLElement, name: PerliteIconName): void {
  setIcon(container, name);
}
