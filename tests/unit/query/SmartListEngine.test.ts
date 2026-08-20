import { describe, expect, test } from "vitest";
import type { CalendarDate } from "../../../src/model/CalendarDate.js";
import { parseLine } from "../../../src/parser/TaskLineParser.js";
import { matches } from "../../../src/query/FilterEngine.js";
import * as BuiltInSmartLists from "../../../src/query/BuiltInSmartLists.js";
import { evaluate } from "../../../src/query/SmartListEngine.js";
import { createSmartList, type SmartList } from "../../../src/query/SmartList.js";
import { sortCriterion } from "../../../src/query/SortCriterion.js";

/** 1:1 port of `PerliteCoreTests/SmartListTests.swift`. */
const TODAY: CalendarDate = { year: 2026, month: 8, day: 15 };

function task(line: string) {
  return parseLine(line);
}

function listMatches(list: SmartList, t: ReturnType<typeof task>): boolean {
  return matches(t, list.filter, TODAY);
}

describe("BuiltInSmartLists", () => {
  test("today includes overdue and due-today via either due or scheduled, but not done", () => {
    const list = BuiltInSmartLists.today;
    expect(listMatches(list, task("- [ ] Overdue #task 📅 2026-08-14"))).toBe(true);
    expect(listMatches(list, task("- [ ] DueToday #task 📅 2026-08-15"))).toBe(true);
    expect(listMatches(list, task("- [ ] ScheduledToday #task ⏳ 2026-08-15"))).toBe(true);
    expect(listMatches(list, task("- [ ] Future #task 📅 2026-08-16"))).toBe(false);
    expect(listMatches(list, task("- [x] DoneOverdue #task 📅 2026-08-14"))).toBe(false);
  });

  test("overdue only checks due, not scheduled, and excludes today", () => {
    const list = BuiltInSmartLists.overdue;
    expect(listMatches(list, task("- [ ] Overdue #task 📅 2026-08-14"))).toBe(true);
    expect(listMatches(list, task("- [ ] DueToday #task 📅 2026-08-15"))).toBe(false);
    expect(listMatches(list, task("- [ ] ScheduledOverdue #task ⏳ 2026-08-14"))).toBe(false);
    expect(listMatches(list, task("- [x] Done #task 📅 2026-08-14"))).toBe(false);
  });

  test("upcoming covers next7Days inclusively and has no not-done qualifier", () => {
    const list = BuiltInSmartLists.upcoming;
    expect(listMatches(list, task("- [ ] Today #task 📅 2026-08-15"))).toBe(true);
    expect(listMatches(list, task("- [ ] Boundary #task 📅 2026-08-22"))).toBe(true);
    expect(listMatches(list, task("- [ ] TooFar #task 📅 2026-08-23"))).toBe(false);
    expect(listMatches(list, task("- [ ] Past #task 📅 2026-08-14"))).toBe(false);
    // Literal spec table has no "not done" on this row, unlike the other four.
    expect(listMatches(list, task("- [x] DoneButSoon #task 📅 2026-08-16"))).toBe(true);
  });

  test("anytime requires no date at all and not done", () => {
    const list = BuiltInSmartLists.anytime;
    expect(listMatches(list, task("- [ ] No dates #task"))).toBe(true);
    expect(listMatches(list, task("- [x] No dates but done #task"))).toBe(false);
    expect(listMatches(list, task("- [ ] Has due #task 📅 2026-08-20"))).toBe(false);
    expect(listMatches(list, task("- [ ] Has scheduled #task ⏳ 2026-08-20"))).toBe(false);
    expect(listMatches(list, task("- [ ] Has start #task 🛫 2026-08-20"))).toBe(false);
  });

  test("flagged is highest or high, not done", () => {
    const list = BuiltInSmartLists.flagged;
    expect(listMatches(list, task("- [ ] Highest #task 🔺"))).toBe(true);
    expect(listMatches(list, task("- [ ] High #task ⏫"))).toBe(true);
    expect(listMatches(list, task("- [ ] Medium #task 🔼"))).toBe(false);
    expect(listMatches(list, task("- [x] DoneHighest #task 🔺"))).toBe(false);
  });

  test("recentlyCompleted requires done and a done-date within the last 7 days", () => {
    const list = BuiltInSmartLists.recentlyCompleted;
    expect(listMatches(list, task("- [x] Recent #task ✅ 2026-08-12"))).toBe(true);
    expect(listMatches(list, task("- [x] Boundary #task ✅ 2026-08-08"))).toBe(true);
    expect(listMatches(list, task("- [x] TooOld #task ✅ 2026-08-07"))).toBe(false);
    expect(listMatches(list, task("- [ ] NotDone #task"))).toBe(false);
  });
});

describe("SmartListEngine.evaluate", () => {
  test("produces one result per list with correct counts", () => {
    const tasks = [
      task("- [ ] Overdue #task 📅 2026-08-14"),
      task("- [ ] Flagged #task 🔺"),
      task("- [ ] Plain #task"),
      task("- [x] RecentlyDone #task ✅ 2026-08-13"),
    ];
    const results = evaluate(tasks, BuiltInSmartLists.all, TODAY);

    expect(results).toHaveLength(BuiltInSmartLists.all.length);
    const byID = new Map(results.map((r) => [r.smartList.id, r]));
    expect(byID.get("builtin.overdue")?.tasks.length).toBe(1);
    expect(byID.get("builtin.today")?.tasks.length).toBe(1); // the overdue task also qualifies for Today
    expect(byID.get("builtin.flagged")?.tasks.length).toBe(1);
    expect(byID.get("builtin.anytime")?.tasks.length).toBe(2); // "Flagged" and "Plain" both have no dates and aren't done
    expect(byID.get("builtin.recentlyCompleted")?.tasks.length).toBe(1);
  });

  test("applies per-list sorting", () => {
    const tasks = [task("- [ ] B #task 🔺"), task("- [ ] A #task 🔺")];
    const sortedByDescription = createSmartList({
      id: "test.flaggedByName",
      name: "Flagged by name",
      icon: "flag",
      accentToken: "smartlist.flagged",
      filter: { type: "criterion", criterion: { type: "priority", value: "highest" } },
      sorting: [sortCriterion("description")],
    });
    const results = evaluate(tasks, [sortedByDescription], TODAY);
    expect(results[0]?.tasks.map((t) => t.description)).toEqual(["A", "B"]);
  });
});
