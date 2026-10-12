import { setIcon } from "obsidian";

export interface EmptyStateOptions {
  readonly icon: string;
  readonly title: string;
  readonly hint?: string;
  readonly action?: { readonly label: string; readonly onClick: () => void };
}

/** The shared "nothing here" shape every list-like view falls back to — an icon, a short
 * title, an optional one-line hint, and an optional primary action — replacing each
 * view's previous bare `.perlite-empty-state` text div. */
export function renderEmptyState(container: HTMLElement, options: EmptyStateOptions): HTMLElement {
  const el = container.createDiv({ cls: "perlite-empty-state" });

  const iconEl = el.createDiv({ cls: "perlite-empty-state__icon" });
  setIcon(iconEl, options.icon);

  el.createDiv({ cls: "perlite-empty-state__title", text: options.title });

  if (options.hint !== undefined) {
    el.createDiv({ cls: "perlite-empty-state__hint", text: options.hint });
  }

  if (options.action !== undefined) {
    const action = options.action;
    const button = el.createEl("button", { cls: "mod-cta perlite-empty-state__action", text: action.label });
    button.addEventListener("click", action.onClick);
  }

  return el;
}
