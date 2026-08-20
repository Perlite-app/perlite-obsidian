/**
 * Task priority as encoded by the Tasks plugin's emoji markers. `"normal"` is the
 * absence of a marker, not an emitted character.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Model/Priority.swift`, as a string union
 * (the TS analogue of Swift's `String`-raw-value `CaseIterable` enum) — `PRIORITY_VALUES`
 * mirrors `Priority.allCases`.
 */
export type Priority = "highest" | "high" | "medium" | "normal" | "low" | "lowest";

export const PRIORITY_VALUES: readonly Priority[] = ["highest", "high", "medium", "normal", "low", "lowest"];

const MARKER_BY_PRIORITY: Readonly<Record<Priority, string | null>> = {
  highest: "🔺",
  high: "⏫",
  medium: "🔼",
  normal: null,
  low: "🔽",
  lowest: "⏬",
};

/** The emoji marker for this priority, or `null` for `"normal"` which has none. */
export function priorityMarker(priority: Priority): string | null {
  return MARKER_BY_PRIORITY[priority];
}

export function priorityFromMarker(marker: string): Priority | null {
  switch (marker) {
    case "🔺":
      return "highest";
    case "⏫":
      return "high";
    case "🔼":
      return "medium";
    case "🔽":
      return "low";
    case "⏬":
      return "lowest";
    default:
      return null;
  }
}
