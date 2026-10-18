import type { Priority } from "../model/Priority.js";

/** The Lucide icon for each priority — the Task sidebar's picker and the board's
 * priority pill draw the same chevrons. */
export const PRIORITY_ICON: Readonly<Record<Priority, string>> = {
  normal: "minus",
  lowest: "chevrons-down",
  low: "chevron-down",
  medium: "chevron-up",
  high: "chevrons-up",
  highest: "alert-triangle",
};
