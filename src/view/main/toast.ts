import type { Undo } from "../taskWrites.js";

/**
 * The board's and calendar's "what just happened" line: what was written and where
 * ("Wrote [x] · Work/Reviews.md line 42"), optionally the new markdown line, and Undo
 * while it's on screen. One at a time per view; gone after a few seconds or on the
 * next one. A `role="status"` region, so screen readers hear it.
 */
export class Toast {
  private el: HTMLElement | null = null;
  private timer: number | null = null;

  constructor(private readonly host: HTMLElement) {}

  show(headline: string, options: { readonly md?: string; readonly undo?: Undo | null; readonly onUndone?: () => void } = {}): void {
    this.dismiss();
    const el = this.host.createDiv({ cls: "perlite-toast", attr: { role: "status" } });
    const text = el.createDiv({ cls: "perlite-toast__text" });
    text.createSpan({ cls: "perlite-toast__headline", text: headline });
    if (options.md !== undefined) text.createEl("code", { cls: "perlite-toast__md", text: options.md });
    const undo = options.undo;
    if (undo !== undefined && undo !== null) {
      const button = el.createEl("button", { cls: "perlite-toast__undo", text: "Undo", attr: { type: "button" } });
      button.addEventListener("click", () => {
        this.dismiss();
        void undo().then(() => options.onUndone?.());
      });
    }
    this.el = el;
    this.timer = window.setTimeout(() => this.dismiss(), 6000);
  }

  dismiss(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.el?.remove();
    this.el = null;
  }
}
