/**
 * Wave 3's one shared drag mechanism, used by both the kanban board (card → column) and
 * the calendar lens (agenda row → day cell). Built on **Pointer Events**
 * (`pointerdown`/`pointermove`/`pointerup`), not the HTML5 Drag-and-Drop API —
 * `manifest.json` sets `isDesktopOnly: false`, and HTML5 DnD does not fire from touch
 * input in a mobile WebView, while Pointer Events unify mouse/touch/pen behind one event
 * model. This is also what makes the roadmap's own "dedicated drag handle, not a
 * whole-card drag surface" design note (an explicit complaint about the community
 * Kanban plugin) trivial to satisfy: the listener is attached only to the handle
 * element, never the card/row itself, so the rest of the card stays free for text
 * selection and tap-to-open.
 */

const DRAG_THRESHOLD_PX = 4;

export interface AttachDragHandleOptions {
  /** Selector for valid drop targets, tested via `elementsFromPoint(...).closest(...)`
   * under the pointer on every move — e.g. `.perlite-kanban-column` or
   * `.perlite-calendar-cell`. */
  readonly dropTargetSelector: string;
  /** Fired once, the moment a drag actually starts (after the movement threshold is
   * crossed) — not on every `pointerdown`, so a plain tap/click on the handle never
   * fires it. */
  readonly onDragStart?: () => void;
  /** Fired on pointer-up if a valid drop target was live at that moment. Never fired for
   * a released-with-no-target drag (dropped outside every target) or a cancelled one. */
  readonly onDrop: (targetEl: HTMLElement) => void;
}

/** Binds pointer-based dragging to `handleEl`; `cardEl` is the element visually dragged
 * (cloned into a floating ghost that follows the pointer) and marked
 * `.perlite-drag-source--dragging` in place while the drag is live. Idempotent to call
 * once per handle — this plugin never re-attaches to the same element, since every
 * caller rebuilds its DOM from scratch on each `refresh()` (see `PerliteListView`'s own
 * doc comment on why views re-render wholesale rather than diffing). */
export function attachDragHandle(handleEl: HTMLElement, cardEl: HTMLElement, options: AttachDragHandleOptions): void {
  handleEl.addEventListener("pointerdown", (startEvent: PointerEvent) => {
    // Ignore secondary mouse buttons and non-primary touch points (multi-touch) — only
    // ever one drag in flight per handle.
    if (!startEvent.isPrimary) return;
    if (startEvent.pointerType === "mouse" && startEvent.button !== 0) return;

    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    let dragging = false;
    let ghost: HTMLElement | null = null;
    let activeTarget: HTMLElement | null = null;
    let offsetX = 0;
    let offsetY = 0;

    const clearActiveTarget = (): void => {
      activeTarget?.removeClass("perlite-drop-target--active");
      activeTarget = null;
    };

    const startDragging = (event: PointerEvent): void => {
      dragging = true;
      handleEl.setPointerCapture(event.pointerId);
      cardEl.addClass("perlite-drag-source--dragging");

      const rect = cardEl.getBoundingClientRect();
      offsetX = startX - rect.left;
      offsetY = startY - rect.top;

      ghost = cardEl.cloneNode(true) as HTMLElement;
      ghost.addClass("perlite-drag-ghost");
      ghost.style.width = `${rect.width}px`;
      ghost.style.left = `${rect.left}px`;
      ghost.style.top = `${rect.top}px`;
      document.body.appendChild(ghost);

      options.onDragStart?.();
    };

    const moveGhostTo = (clientX: number, clientY: number): void => {
      if (ghost === null) return;
      ghost.style.left = `${clientX - offsetX}px`;
      ghost.style.top = `${clientY - offsetY}px`;
    };

    const updateActiveTarget = (clientX: number, clientY: number): void => {
      if (ghost !== null) ghost.style.display = "none"; // exclude the ghost itself from hit-testing
      const candidate = document
        .elementsFromPoint(clientX, clientY)
        .map((el) => el.closest<HTMLElement>(options.dropTargetSelector))
        .find((el): el is HTMLElement => el !== null);
      if (ghost !== null) ghost.style.display = "";

      if (candidate !== activeTarget) {
        clearActiveTarget();
        activeTarget = candidate ?? null;
        activeTarget?.addClass("perlite-drop-target--active");
      }
    };

    const cleanup = (): void => {
      ghost?.remove();
      ghost = null;
      cardEl.removeClass("perlite-drag-source--dragging");
      clearActiveTarget();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };

    const onMove = (event: PointerEvent): void => {
      if (!dragging) {
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        startDragging(event);
      }
      moveGhostTo(event.clientX, event.clientY);
      updateActiveTarget(event.clientX, event.clientY);
    };

    const onUp = (event: PointerEvent): void => {
      const droppedOn = activeTarget;
      cleanup();
      if (dragging && droppedOn !== null) options.onDrop(droppedOn);
    };

    const onCancel = (): void => {
      cleanup();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  });
}
