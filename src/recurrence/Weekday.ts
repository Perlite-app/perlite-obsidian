/**
 * A day of the week, for the recurrence grammar's `"every week on Sunday"` form.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Recurrence/Weekday.swift`. Raw values
 * match `Foundation`'s `Calendar.weekday` component (1 = Sunday ... 7 = Saturday)
 * directly, same as the Swift original documents — JS's own `Date.getUTCDay()` is 0-6
 * (Sunday = 0), converted with a plain `+1`/`-1` at the one call site in
 * `RecurrenceCalculator.ts` that actually talks to a `Date`.
 */
export type Weekday = "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";

export const WEEKDAY_VALUES: readonly Weekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const RAW_VALUE_BY_WEEKDAY: Readonly<Record<Weekday, number>> = {
  sunday: 1,
  monday: 2,
  tuesday: 3,
  wednesday: 4,
  thursday: 5,
  friday: 6,
  saturday: 7,
};

const WEEKDAY_BY_RAW_VALUE: ReadonlyMap<number, Weekday> = new Map(WEEKDAY_VALUES.map((w) => [RAW_VALUE_BY_WEEKDAY[w], w]));

export function weekdayRawValue(weekday: Weekday): number {
  return RAW_VALUE_BY_WEEKDAY[weekday];
}

export function weekdayFromRawValue(value: number): Weekday | null {
  return WEEKDAY_BY_RAW_VALUE.get(value) ?? null;
}

/** Accepts full names and 3-letter abbreviations, case-insensitive — the two forms real
 * vault text is likely to use. */
export function parseWeekday(name: string): Weekday | null {
  switch (name.trim().toLowerCase()) {
    case "sunday":
    case "sun":
      return "sunday";
    case "monday":
    case "mon":
      return "monday";
    case "tuesday":
    case "tue":
      return "tuesday";
    case "wednesday":
    case "wed":
      return "wednesday";
    case "thursday":
    case "thu":
      return "thursday";
    case "friday":
    case "fri":
      return "friday";
    case "saturday":
    case "sat":
      return "saturday";
    default:
      return null;
  }
}
