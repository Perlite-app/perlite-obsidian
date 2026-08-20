/**
 * A task's checkbox status. The character between the brackets is stored opaquely so that
 * custom statuses from the Tasks plugin's status-configuration feature (`[/]` in progress,
 * `[!]` on hold, `[>]` planned, or any other single character a user has defined) round-trip
 * exactly. `kind` is a best-effort classification derived from well-known characters, used
 * for filtering and display — it is never written back in place of the original symbol.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Model/TaskStatus.swift`. `symbol` is
 * assumed (not runtime-validated, matching the Swift original leaving that to its type
 * system) to be exactly one character — callers in `parser/`/`write/` are responsible
 * for always passing a single character, the same invariant Swift's `Character` type
 * enforces at the type level rather than at the constructor.
 */
export type TaskStatusKind = "todo" | "done" | "cancelled" | "custom";

export interface TaskStatus {
  readonly symbol: string;
  readonly kind: TaskStatusKind;
}

function kindForSymbol(symbol: string): TaskStatusKind {
  switch (symbol) {
    case " ":
      return "todo";
    case "x":
    case "X":
      return "done";
    case "-":
      return "cancelled";
    default:
      return "custom";
  }
}

export function createTaskStatus(symbol: string): TaskStatus {
  return { symbol, kind: kindForSymbol(symbol) };
}

export const TASK_STATUS_TODO: TaskStatus = createTaskStatus(" ");
export const TASK_STATUS_DONE: TaskStatus = createTaskStatus("x");
export const TASK_STATUS_CANCELLED: TaskStatus = createTaskStatus("-");
