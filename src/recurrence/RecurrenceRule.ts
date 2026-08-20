import type { Weekday } from "./Weekday.js";

/**
 * A parsed recurrence rule, covering the MVP's explicit subset of the Tasks-plugin
 * grammar: daily/weekly/monthly/yearly with intervals, weekday constraints on weekly
 * rules, and the "when done" variant. Anything outside this subset is not represented by
 * this type at all — `parseRecurrenceRule` returns `null` for it, which is the signal
 * `RecurrenceEngine` uses to refuse completion rather than guess.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Recurrence/RecurrenceRule.swift`.
 */
export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

export interface RecurrenceRule {
  readonly frequency: RecurrenceFrequency;
  /** Always ≥ 1; "every week" and "every 1 weeks" both parse to `interval: 1`. */
  readonly interval: number;
  /** Only meaningful when `frequency === "weekly"`; empty otherwise. */
  readonly weekdays: readonly Weekday[];
  /** True for the `"... when done"` suffix — next instance is computed from the
   * completion date rather than the previous due date. */
  readonly whenDone: boolean;
}
