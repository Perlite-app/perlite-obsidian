import { describe, expect, test } from "vitest";
import { calendarDateToISOString, type CalendarDate } from "../../../src/model/CalendarDate.js";
import { addDays } from "../../../src/recurrence/RecurrenceCalculator.js";
import { parseLine } from "../../../src/parser/TaskLineParser.js";
import { DEFAULT_SEGMENT_TITLE, DEFAULT_SEGMENTS, matchesDefaultSegment } from "../../../src/query/defaultSegments.js";

/** 1:1 port of `PerliteCoreTests/DefaultListViewTests.swift` — same fixed Saturday, same
 * cases, same order. */
const TODAY: CalendarDate = { year: 2026, month: 8, day: 15 };

function task(line: string) {
  return parseLine(line);
}

describe("matchesDefaultSegment", () => {
  test("overdue only checks due, not scheduled, and excludes today", () => {
    expect(matchesDefaultSegment(task("- [ ] Overdue #task 📅 2026-08-14"), "overdue", TODAY)).toBe(true);
    expect(matchesDefaultSegment(task("- [ ] DueToday #task 📅 2026-08-15"), "overdue", TODAY)).toBe(false);
    expect(matchesDefaultSegment(task("- [ ] ScheduledOverdue #task ⏳ 2026-08-14"), "overdue", TODAY)).toBe(false);
    expect(matchesDefaultSegment(task("- [x] Done #task 📅 2026-08-14"), "overdue", TODAY)).toBe(false);
  });

  test("today includes due-or-scheduled today and scheduled-overdue, but not due-overdue or done", () => {
    // Regression coverage for "same task shows up both in Overdue and in Today" — a
    // due-overdue task now belongs solely to Overdue.
    expect(matchesDefaultSegment(task("- [ ] DueOverdue #task 📅 2026-08-14"), "today", TODAY)).toBe(false);
    expect(matchesDefaultSegment(task("- [ ] ScheduledOverdue #task ⏳ 2026-08-14"), "today", TODAY)).toBe(true);
    expect(matchesDefaultSegment(task("- [ ] DueToday #task 📅 2026-08-15"), "today", TODAY)).toBe(true);
    expect(matchesDefaultSegment(task("- [ ] ScheduledToday #task ⏳ 2026-08-15"), "today", TODAY)).toBe(true);
    expect(matchesDefaultSegment(task("- [ ] Future #task 📅 2026-08-16"), "today", TODAY)).toBe(false);
    expect(matchesDefaultSegment(task("- [x] DoneOverdue #task 📅 2026-08-14"), "today", TODAY)).toBe(false);
  });

  test("overdue and today are mutually exclusive across a week of boundaries", () => {
    for (let offset = -7; offset <= 0; offset++) {
      const date = addDays(offset, TODAY);
      expect(date).not.toBeNull();
      const isoString = calendarDateToISOString(date!);
      const t = task(`- [ ] Offset${offset} #task 📅 ${isoString}`);
      const inOverdue = matchesDefaultSegment(t, "overdue", TODAY);
      const inToday = matchesDefaultSegment(t, "today", TODAY);
      expect(inOverdue && inToday).toBe(false);
    }
  });

  test("upcoming covers any future date with no upper bound, excluding today and done", () => {
    expect(matchesDefaultSegment(task("- [ ] Tomorrow #task 📅 2026-08-16"), "upcoming", TODAY)).toBe(true);
    expect(matchesDefaultSegment(task("- [ ] Boundary #task 📅 2026-08-22"), "upcoming", TODAY)).toBe(true);
    expect(matchesDefaultSegment(task("- [ ] BeyondOldSevenDayCap #task 📅 2026-08-23"), "upcoming", TODAY)).toBe(true);
    expect(matchesDefaultSegment(task("- [ ] MonthsOut #task 📅 2027-01-01"), "upcoming", TODAY)).toBe(true);
    expect(matchesDefaultSegment(task("- [ ] Past #task 📅 2026-08-14"), "upcoming", TODAY)).toBe(false);
    expect(matchesDefaultSegment(task("- [ ] DueToday #task 📅 2026-08-15"), "upcoming", TODAY)).toBe(false);
    expect(matchesDefaultSegment(task("- [ ] ScheduledToday #task ⏳ 2026-08-15"), "upcoming", TODAY)).toBe(false);
    expect(
      matchesDefaultSegment(task("- [ ] OverdueDueSoonScheduled #task 📅 2026-08-14 ⏳ 2026-08-16"), "upcoming", TODAY),
    ).toBe(false);
    expect(matchesDefaultSegment(task("- [x] DoneButSoon #task 📅 2026-08-16"), "upcoming", TODAY)).toBe(false);
  });

  test("today and upcoming are mutually exclusive across a week of boundaries", () => {
    for (let offset = -1; offset <= 8; offset++) {
      const date = addDays(offset, TODAY);
      expect(date).not.toBeNull();
      const isoString = calendarDateToISOString(date!);
      for (const marker of ["📅", "⏳"]) {
        const t = task(`- [ ] Offset${offset} #task ${marker} ${isoString}`);
        const inToday = matchesDefaultSegment(t, "today", TODAY);
        const inUpcoming = matchesDefaultSegment(t, "upcoming", TODAY);
        expect(inToday && inUpcoming).toBe(false);
      }
    }
  });

  test("noDate requires no date at all, and not done", () => {
    expect(matchesDefaultSegment(task("- [ ] No dates #task"), "noDate", TODAY)).toBe(true);
    expect(matchesDefaultSegment(task("- [x] No dates but done #task"), "noDate", TODAY)).toBe(false);
    expect(matchesDefaultSegment(task("- [ ] Has due #task 📅 2026-08-20"), "noDate", TODAY)).toBe(false);
    expect(matchesDefaultSegment(task("- [ ] Has scheduled #task ⏳ 2026-08-20"), "noDate", TODAY)).toBe(false);
    expect(matchesDefaultSegment(task("- [ ] Has start #task 🛫 2026-08-20"), "noDate", TODAY)).toBe(false);
  });

  test("all segments have display titles in spec order", () => {
    expect(DEFAULT_SEGMENTS.map((segment) => DEFAULT_SEGMENT_TITLE[segment])).toEqual(["Overdue", "Today", "Upcoming", "No Date"]);
  });
});
