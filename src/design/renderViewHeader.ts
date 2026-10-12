import { setIcon, setTooltip } from "obsidian";

export interface ViewHeaderAction {
  readonly icon: string;
  readonly label: string;
  readonly onClick: () => void;
  /** Shows `label` as visible button text styled `mod-cta` (Obsidian's own primary-
   * button class) instead of an icon-only button — for the one action a header wants to
   * make unmissable, e.g. "Add task". */
  readonly primary?: boolean;
  /** Reflected as `aria-pressed` — for a toggle action like "Show completed". */
  readonly pressed?: boolean;
}

export interface ViewHeaderOptions {
  readonly title: string;
  readonly actions?: readonly ViewHeaderAction[];
}

/** A view's own sticky title bar — a title on the left, a cluster of action buttons on
 * the right. Distinct from Obsidian's own `ItemView.addAction` (which places icons next
 * to the tab itself, outside the view's scrollable content): this is in-content chrome,
 * for a view that wants more than one primary action visible without a menu. */
export function renderViewHeader(container: HTMLElement, options: ViewHeaderOptions): HTMLElement {
  const header = container.createDiv({ cls: "perlite-view-header" });
  header.createEl("h5", { cls: "perlite-view-header__title", text: options.title });

  const actionsEl = header.createDiv({ cls: "perlite-view-header__actions" });
  for (const action of options.actions ?? []) {
    const attrs: Record<string, string> = { "aria-label": action.label };
    if (action.pressed !== undefined) attrs["aria-pressed"] = String(action.pressed);

    const button = actionsEl.createEl("button", {
      cls: action.primary === true ? "mod-cta perlite-view-header__primary" : "clickable-icon",
      attr: attrs,
    });
    setTooltip(button, action.label);

    if (action.primary === true) {
      const iconEl = button.createSpan({ cls: "perlite-view-header__primary-icon" });
      setIcon(iconEl, action.icon);
      button.createSpan({ text: action.label });
    } else {
      setIcon(button, action.icon);
    }

    button.addEventListener("click", action.onClick);
  }

  return header;
}
