import { setIcon } from "obsidian";

export interface SectionHeaderOptions {
  readonly icon: string;
  readonly title: string;
  readonly count?: number;
  /** A CSS class applied to the icon only — e.g. one of `styles.css`'s
   * `perlite-accent-*` utilities or an existing `perlite-chip--priority-*` colour class.
   * Omitted for the default muted heading colour. */
  readonly accentClass?: string;
}

/** One `perlite-section-header` row: icon, heading text, and a trailing count pill — the
 * shared shape every grouped view (the default segmented list, a grouped smart list, a
 * kanban column, the calendar agenda) renders its section/column heading through,
 * replacing each view's own previous hand-built `h6` + `"Title (n)"` string. */
export function renderSectionHeader(container: HTMLElement, options: SectionHeaderOptions): HTMLElement {
  const header = container.createDiv({ cls: "perlite-section-header" });

  const iconEl = header.createSpan({ cls: "perlite-section-header__icon" });
  if (options.accentClass !== undefined) iconEl.addClass(options.accentClass);
  setIcon(iconEl, options.icon);

  header.createEl("h6", { cls: "perlite-section-header__title", text: options.title });

  if (options.count !== undefined) {
    header.createSpan({ cls: "perlite-section-header__count", text: String(options.count) });
  }

  return header;
}
