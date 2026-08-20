import { describe, expect, test } from "vitest";
import { addDaysUTC, addMonths, gridDates, weekdayOf } from "../../../src/query/CalendarGrid.js";

describe("CalendarGrid", () => {
  describe("weekdayOf", () => {
    test("August 1, 2026 is a Saturday", () => {
      expect(weekdayOf({ year: 2026, month: 8, day: 1 })).toBe(6);
    });

    test("January 1, 2026 is a Thursday", () => {
      expect(weekdayOf({ year: 2026, month: 1, day: 1 })).toBe(4);
    });
  });

  describe("addDaysUTC", () => {
    test("adds across a month boundary", () => {
      expect(addDaysUTC({ year: 2026, month: 8, day: 30 }, 3)).toEqual({ year: 2026, month: 9, day: 2 });
    });

    test("subtracts across a month boundary", () => {
      expect(addDaysUTC({ year: 2026, month: 8, day: 1 }, -1)).toEqual({ year: 2026, month: 7, day: 31 });
    });

    test("handles a leap-year February correctly", () => {
      expect(addDaysUTC({ year: 2024, month: 2, day: 28 }, 1)).toEqual({ year: 2024, month: 2, day: 29 });
      expect(addDaysUTC({ year: 2024, month: 2, day: 29 }, 1)).toEqual({ year: 2024, month: 3, day: 1 });
    });
  });

  describe("addMonths", () => {
    test("steps forward within a year", () => {
      expect(addMonths({ year: 2026, month: 3, day: 1 }, 2)).toEqual({ year: 2026, month: 5, day: 1 });
    });

    test("steps backward within a year", () => {
      expect(addMonths({ year: 2026, month: 5, day: 1 }, -2)).toEqual({ year: 2026, month: 3, day: 1 });
    });

    test("rolls forward across a year boundary — December to January", () => {
      expect(addMonths({ year: 2026, month: 12, day: 1 }, 1)).toEqual({ year: 2027, month: 1, day: 1 });
    });

    test("rolls backward across a year boundary — January to December", () => {
      expect(addMonths({ year: 2026, month: 1, day: 1 }, -1)).toEqual({ year: 2025, month: 12, day: 1 });
    });

    test("a large delta rolls across multiple years correctly", () => {
      expect(addMonths({ year: 2026, month: 8, day: 1 }, 17)).toEqual({ year: 2028, month: 1, day: 1 });
      expect(addMonths({ year: 2026, month: 8, day: 1 }, -17)).toEqual({ year: 2025, month: 3, day: 1 });
    });
  });

  describe("gridDates", () => {
    test("always returns exactly 42 dates", () => {
      expect(gridDates({ year: 2026, month: 8, day: 1 }, 0)).toHaveLength(42);
    });

    test("Sunday-first (firstWeekday=0): August 2026 starts on the preceding Sunday, July 26", () => {
      const dates = gridDates({ year: 2026, month: 8, day: 1 }, 0);
      expect(dates[0]).toEqual({ year: 2026, month: 7, day: 26 });
      expect(dates[41]).toEqual({ year: 2026, month: 9, day: 5 });
    });

    test("Monday-first (firstWeekday=1): August 2026 starts on the preceding Monday, July 27", () => {
      const dates = gridDates({ year: 2026, month: 8, day: 1 }, 1);
      expect(dates[0]).toEqual({ year: 2026, month: 7, day: 27 });
      expect(dates[41]).toEqual({ year: 2026, month: 9, day: 6 });
    });

    test("a month whose first day already falls on firstWeekday has zero leading days", () => {
      // January 1, 2026 is a Thursday (weekday 4) — a Thursday-first grid should start
      // exactly on the 1st, not before it.
      const dates = gridDates({ year: 2026, month: 1, day: 1 }, 4);
      expect(dates[0]).toEqual({ year: 2026, month: 1, day: 1 });
    });

    test("dates are consecutive with no gaps or duplicates", () => {
      const dates = gridDates({ year: 2026, month: 2, day: 1 }, 1);
      for (let i = 1; i < dates.length; i++) {
        expect(addDaysUTC(dates[i - 1]!, 1)).toEqual(dates[i]);
      }
    });
  });
});
