import { describe, expect, test } from "vitest";
import type { CalendarDate } from "../../../src/model/CalendarDate.js";
import { createTaskTag } from "../../../src/model/TaskTag.js";
import { parseLine } from "../../../src/parser/TaskLineParser.js";
import { apply, matches, search } from "../../../src/query/FilterEngine.js";
import type { FilterExpression } from "../../../src/query/FilterCriterion.js";

/** 1:1 port of `PerliteCoreTests/FilterEngineTests.swift`. */
const TODAY: CalendarDate = { year: 2026, month: 8, day: 15 };

function task(line: string, path?: string) {
  return parseLine(line, path !== undefined ? { location: { filePath: path, lineIndex: 0 } } : undefined);
}

describe("FilterEngine", () => {
  test("status criterion", () => {
    const todo = task("- [ ] Todo #task");
    const done = task("- [x] Done #task");
    expect(matches(todo, { type: "criterion", criterion: { type: "status", kind: "todo" } }, TODAY)).toBe(true);
    expect(matches(done, { type: "criterion", criterion: { type: "status", kind: "todo" } }, TODAY)).toBe(false);
    expect(matches(done, { type: "criterion", criterion: { type: "status", kind: "done" } }, TODAY)).toBe(true);
  });

  test("priority criterion", () => {
    const high = task("- [ ] Important #task ⏫");
    expect(matches(high, { type: "criterion", criterion: { type: "priority", value: "high" } }, TODAY)).toBe(true);
    expect(matches(high, { type: "criterion", criterion: { type: "priority", value: "normal" } }, TODAY)).toBe(false);
  });

  test("absolute date ranges", () => {
    const t = task("- [ ] Task #task 📅 2026-08-13");
    expect(matches(t, { type: "criterion", criterion: { type: "dueDate", range: { type: "before", date: { year: 2026, month: 8, day: 14 } } } }, TODAY)).toBe(true);
    expect(matches(t, { type: "criterion", criterion: { type: "dueDate", range: { type: "before", date: { year: 2026, month: 8, day: 13 } } } }, TODAY)).toBe(false);
    expect(matches(t, { type: "criterion", criterion: { type: "dueDate", range: { type: "onOrAfter", date: { year: 2026, month: 8, day: 13 } } } }, TODAY)).toBe(true);
    expect(
      matches(
        t,
        { type: "criterion", criterion: { type: "dueDate", range: { type: "between", start: { year: 2026, month: 8, day: 1 }, end: { year: 2026, month: 8, day: 31 } } } },
        TODAY,
      ),
    ).toBe(true);
  });

  test("dateRange none matches only an absent date", () => {
    const withDue = task("- [ ] Task #task 📅 2026-08-13");
    const withoutDue = task("- [ ] Task #task");
    expect(matches(withDue, { type: "criterion", criterion: { type: "dueDate", range: { type: "none" } } }, TODAY)).toBe(false);
    expect(matches(withoutDue, { type: "criterion", criterion: { type: "dueDate", range: { type: "none" } } }, TODAY)).toBe(true);
  });

  test("relative overdue", () => {
    const overdue = task("- [ ] Task #task 📅 2026-08-14");
    const future = task("- [ ] Task #task 📅 2026-08-16");
    const expr: FilterExpression = { type: "criterion", criterion: { type: "dueDate", range: { type: "relative", value: "overdue" } } };
    expect(matches(overdue, expr, TODAY)).toBe(true);
    expect(matches(future, expr, TODAY)).toBe(false);
  });

  test("relative today", () => {
    const dueToday = task("- [ ] Task #task 📅 2026-08-15");
    expect(matches(dueToday, { type: "criterion", criterion: { type: "dueDate", range: { type: "relative", value: "today" } } }, TODAY)).toBe(true);
  });

  test("relative next7Days is inclusive of both ends", () => {
    const dueToday = task("- [ ] Task #task 📅 2026-08-15");
    const dueBoundary = task("- [ ] Task #task 📅 2026-08-22");
    const dueAfter = task("- [ ] Task #task 📅 2026-08-23");
    const dueBefore = task("- [ ] Task #task 📅 2026-08-14");
    const expr: FilterExpression = { type: "criterion", criterion: { type: "dueDate", range: { type: "relative", value: "next7Days" } } };
    expect(matches(dueToday, expr, TODAY)).toBe(true);
    expect(matches(dueBoundary, expr, TODAY)).toBe(true);
    expect(matches(dueAfter, expr, TODAY)).toBe(false);
    expect(matches(dueBefore, expr, TODAY)).toBe(false);
  });

  test("tag criteria match inherited tags, not just inline ones", () => {
    const t = parseLine("- [ ] Task #task", { inheritedTags: [createTaskTag("#work")] });
    expect(matches(t, { type: "criterion", criterion: { type: "tagExact", tag: "#work" } }, TODAY)).toBe(true);
    expect(matches(t, { type: "criterion", criterion: { type: "tagContains", text: "wor" } }, TODAY)).toBe(true);
  });

  test("tagExact does not match a nested tag", () => {
    const t = task("- [ ] Task #task #work/urgent");
    expect(matches(t, { type: "criterion", criterion: { type: "tagExact", tag: "#work" } }, TODAY)).toBe(false);
    expect(matches(t, { type: "criterion", criterion: { type: "tagExact", tag: "#work/urgent" } }, TODAY)).toBe(true);
  });

  test("tagContains matches partial text", () => {
    const t = task("- [ ] Task #task #work/urgent");
    expect(matches(t, { type: "criterion", criterion: { type: "tagContains", text: "work" } }, TODAY)).toBe(true);
  });

  test("pathContains requires a location", () => {
    const withLocation = task("- [ ] Task #task", "Projects/roadmap.md");
    const withoutLocation = task("- [ ] Task #task");
    expect(matches(withLocation, { type: "criterion", criterion: { type: "pathContains", text: "Projects" } }, TODAY)).toBe(true);
    expect(matches(withoutLocation, { type: "criterion", criterion: { type: "pathContains", text: "Projects" } }, TODAY)).toBe(false);
  });

  test("textContains searches the description", () => {
    const t = task("- [ ] Buy oat milk #task");
    expect(matches(t, { type: "criterion", criterion: { type: "textContains", text: "oat" } }, TODAY)).toBe(true);
    expect(matches(t, { type: "criterion", criterion: { type: "textContains", text: "bread" } }, TODAY)).toBe(false);
  });

  test("hasDescription criterion", () => {
    const withText = task("- [ ] Buy milk #task");
    const empty = task("- [ ] #task");
    expect(matches(withText, { type: "criterion", criterion: { type: "hasDescription", value: true } }, TODAY)).toBe(true);
    expect(matches(withText, { type: "criterion", criterion: { type: "hasDescription", value: false } }, TODAY)).toBe(false);
    expect(matches(empty, { type: "criterion", criterion: { type: "hasDescription", value: false } }, TODAY)).toBe(true);
  });

  test("and requires all criteria", () => {
    const t = task("- [ ] Buy milk #task #errands ⏫");
    const matching: FilterExpression = {
      type: "and",
      expressions: [{ type: "criterion", criterion: { type: "priority", value: "high" } }, { type: "criterion", criterion: { type: "tagExact", tag: "#errands" } }],
    };
    const nonMatching: FilterExpression = {
      type: "and",
      expressions: [{ type: "criterion", criterion: { type: "priority", value: "high" } }, { type: "criterion", criterion: { type: "tagExact", tag: "#work" } }],
    };
    expect(matches(t, matching, TODAY)).toBe(true);
    expect(matches(t, nonMatching, TODAY)).toBe(false);
  });

  test("or requires any criterion", () => {
    const t = task("- [ ] Buy milk #task ⏫");
    const expr: FilterExpression = {
      type: "or",
      expressions: [{ type: "criterion", criterion: { type: "tagExact", tag: "#work" } }, { type: "criterion", criterion: { type: "priority", value: "high" } }],
    };
    expect(matches(t, expr, TODAY)).toBe(true);
  });

  test("nested boolean composition", () => {
    // (priority == high OR tag == #urgent) AND status == todo
    const t = task("- [ ] Buy milk #task #urgent");
    const expr: FilterExpression = {
      type: "and",
      expressions: [
        { type: "or", expressions: [{ type: "criterion", criterion: { type: "priority", value: "high" } }, { type: "criterion", criterion: { type: "tagExact", tag: "#urgent" } }] },
        { type: "criterion", criterion: { type: "status", kind: "todo" } },
      ],
    };
    expect(matches(t, expr, TODAY)).toBe(true);
  });

  test("not negates the inner expression", () => {
    const t = task("- [x] Done #task");
    expect(matches(t, { type: "not", expression: { type: "criterion", criterion: { type: "status", kind: "done" } } }, TODAY)).toBe(false);
    expect(matches(t, { type: "not", expression: { type: "criterion", criterion: { type: "status", kind: "todo" } } }, TODAY)).toBe(true);
  });

  test("doneDate criterion", () => {
    const t = task("- [x] Done #task ✅ 2026-08-13");
    expect(
      matches(t, { type: "criterion", criterion: { type: "doneDate", range: { type: "onOrAfter", date: { year: 2026, month: 8, day: 1 } } } }, TODAY),
    ).toBe(true);
  });

  test("relative last7Days is inclusive of both ends", () => {
    const boundaryStart = task("- [x] Old #task ✅ 2026-08-08");
    const withinWindow = task("- [x] Mid #task ✅ 2026-08-12");
    const boundaryEnd = task("- [x] Today #task ✅ 2026-08-15");
    const beforeWindow = task("- [x] TooOld #task ✅ 2026-08-07");
    const expr: FilterExpression = { type: "criterion", criterion: { type: "doneDate", range: { type: "relative", value: "last7Days" } } };
    expect(matches(boundaryStart, expr, TODAY)).toBe(true);
    expect(matches(withinWindow, expr, TODAY)).toBe(true);
    expect(matches(boundaryEnd, expr, TODAY)).toBe(true);
    expect(matches(beforeWindow, expr, TODAY)).toBe(false);
  });

  test("search is case-insensitive and an empty query matches nothing", () => {
    const tasks = [task("- [ ] Buy oat milk #task"), task("- [ ] Wash car #task")];
    expect(search(tasks, "OAT")).toHaveLength(1);
    expect(search(tasks, "")).toHaveLength(0);
  });

  test("apply filters a list of tasks", () => {
    const tasks = [task("- [ ] Keep #task ⏫"), task("- [ ] Drop #task 🔽")];
    const result = apply(tasks, { type: "criterion", criterion: { type: "priority", value: "high" } }, TODAY);
    expect(result).toHaveLength(1);
    expect(result[0]?.description).toBe("Keep");
  });
});
