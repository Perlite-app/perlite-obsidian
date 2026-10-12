import { describe, expect, test } from "vitest";
import type { CalendarDate } from "../../../src/model/CalendarDate.js";
import { parseLine } from "../../../src/parser/TaskLineParser.js";
import { isCompletedToday } from "../../../src/query/completedToday.js";

const TODAY: CalendarDate = { year: 2026, month: 8, day: 15 };

function task(line: string) {
  return parseLine(line);
}

describe("isCompletedToday", () => {
  test("requires done status", () => {
    expect(isCompletedToday(task("- [ ] Not done #task ✅ 2026-08-15"), TODAY)).toBe(false);
  });

  test("requires a done date, even when the status is done", () => {
    expect(isCompletedToday(task("- [x] No done date #task"), TODAY)).toBe(false);
  });

  test("matches only when the done date is exactly today", () => {
    expect(isCompletedToday(task("- [x] Done today #task ✅ 2026-08-15"), TODAY)).toBe(true);
    expect(isCompletedToday(task("- [x] Done yesterday #task ✅ 2026-08-14"), TODAY)).toBe(false);
    expect(isCompletedToday(task("- [x] Done tomorrow #task ✅ 2026-08-16"), TODAY)).toBe(false);
  });

  test("ignores due/scheduled dates entirely, unlike the four incomplete-task segments", () => {
    expect(isCompletedToday(task("- [x] Done today, due earlier #task 📅 2026-08-10 ✅ 2026-08-15"), TODAY)).toBe(true);
    expect(isCompletedToday(task("- [x] Due today but done earlier #task 📅 2026-08-15 ✅ 2026-08-14"), TODAY)).toBe(false);
  });
});
