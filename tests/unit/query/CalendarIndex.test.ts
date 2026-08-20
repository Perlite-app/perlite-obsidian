import { describe, expect, test } from "vitest";
import { parseLine } from "../../../src/parser/TaskLineParser.js";
import { anchorDate, index, overdue } from "../../../src/query/CalendarIndex.js";

/** 1:1 port of `PerliteCoreTests/CalendarIndexTests.swift`. */
function task(line: string) {
  return parseLine(line, { location: { filePath: "Notes.md", lineIndex: 0 } });
}

describe("CalendarIndex", () => {
  describe("anchorDate", () => {
    test("a valid due date wins over scheduled", () => {
      const t = task("- [ ] Both #task 📅 2026-08-20 ⏳ 2026-08-15");
      expect(anchorDate(t)).toEqual({ year: 2026, month: 8, day: 20 });
    });

    test("an invalid due date blocks falling through to a valid scheduled date", () => {
      const t = task("- [ ] Malformed due #task 📅 2026-13-45 ⏳ 2026-08-15");
      expect(anchorDate(t)).toBeNull();
    });

    test("an absent due date falls through to a valid scheduled date", () => {
      const t = task("- [ ] Scheduled only #task ⏳ 2026-08-15");
      expect(anchorDate(t)).toEqual({ year: 2026, month: 8, day: 15 });
    });

    test("neither due nor scheduled present yields null", () => {
      const t = task("- [ ] No dates #task");
      expect(anchorDate(t)).toBeNull();
    });

    test("start is never consulted, even alone", () => {
      const t = task("- [ ] Start only #task 🛫 2026-08-10");
      expect(anchorDate(t)).toBeNull();
    });

    test("an invalid scheduled date with no due field also yields null", () => {
      const t = task("- [ ] Malformed scheduled #task ⏳ 2026-13-45");
      expect(anchorDate(t)).toBeNull();
    });
  });

  describe("index", () => {
    test("buckets tasks by anchor date, skipping tasks with no anchor", () => {
      const dueTask = task("- [ ] Due #task 📅 2026-08-20");
      const scheduledTask = task("- [ ] Scheduled #task ⏳ 2026-08-20");
      const noAnchor = task("- [ ] None #task");
      const map = index([dueTask, scheduledTask, noAnchor]);
      expect(map.size).toBe(1);
      expect(map.get("2026-08-20")).toEqual([dueTask, scheduledTask]);
    });

    test("includes done tasks — filtering is the caller's job", () => {
      const done = task("- [x] Done #task 📅 2026-08-20 ✅ 2026-08-19");
      const map = index([done]);
      expect(map.get("2026-08-20")).toEqual([done]);
    });

    test("an empty task list yields an empty map", () => {
      expect(index([]).size).toBe(0);
    });
  });

  describe("overdue", () => {
    const today = { year: 2026, month: 8, day: 20 };

    test("an incomplete task anchored before today is overdue", () => {
      const t = task("- [ ] Late #task 📅 2026-08-19");
      expect(overdue([t], today)).toEqual([t]);
    });

    test("a scheduled-only task that has slipped is still caught — anchor-based, not due-only", () => {
      const t = task("- [ ] Slipped #task ⏳ 2026-08-19");
      expect(overdue([t], today)).toEqual([t]);
    });

    test("a task anchored exactly today is not overdue — strictly before, not on-or-before", () => {
      const t = task("- [ ] Due today #task 📅 2026-08-20");
      expect(overdue([t], today)).toEqual([]);
    });

    test("a done task is excluded even if its anchor date is in the past", () => {
      const t = task("- [x] Done late #task 📅 2026-08-19 ✅ 2026-08-19");
      expect(overdue([t], today)).toEqual([]);
    });

    test("a task with no anchor is never overdue", () => {
      const t = task("- [ ] No date #task");
      expect(overdue([t], today)).toEqual([]);
    });
  });
});
