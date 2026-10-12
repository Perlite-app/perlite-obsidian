import { describe, expect, test } from "vitest";
import { relativeDayLabel } from "../../../src/design/relativeDay.js";

const TODAY = { year: 2026, month: 10, day: 9 };

describe("relativeDayLabel", () => {
  test("names the days around today", () => {
    expect(relativeDayLabel(TODAY, TODAY)).toBe("Today");
    expect(relativeDayLabel({ year: 2026, month: 10, day: 10 }, TODAY)).toBe("Tomorrow");
    expect(relativeDayLabel({ year: 2026, month: 10, day: 8 }, TODAY)).toBe("Yesterday");
  });

  test("crosses a month boundary", () => {
    expect(relativeDayLabel({ year: 2026, month: 11, day: 1 }, { year: 2026, month: 10, day: 31 })).toBe("Tomorrow");
  });

  test("anything else is a short date with the day number", () => {
    expect(relativeDayLabel({ year: 2026, month: 10, day: 13 }, TODAY)).toMatch(/13/);
  });
});
