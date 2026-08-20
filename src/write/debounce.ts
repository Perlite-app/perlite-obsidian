/**
 * §6.4's "debounce free-text edits (500ms), write discrete selections immediately."
 * Discrete selections (status toggle, date picker, priority menu) call their write
 * function directly and never touch this — this only exists for the one case that needs
 * it, a free-text field mid-keystroke. Cancel-and-reschedule on every call, matching the
 * native app's `TaskDetailView` debounce shape exactly: a later call always supersedes
 * an earlier still-pending one, and `cancel()` (called on blur/view teardown) prevents a
 * write firing against a field the user has already left.
 */
export interface Debouncer<Args extends unknown[]> {
  schedule(...args: Args): void;
  cancel(): void;
}

export function createDebouncer<Args extends unknown[]>(fn: (...args: Args) => void, delayMs = 500): Debouncer<Args> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule(...args: Args): void {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn(...args);
      }, delayMs);
    },
    cancel(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
