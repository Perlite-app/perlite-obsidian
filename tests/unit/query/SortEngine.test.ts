import { describe, expect, test } from "vitest";
import { parseLine } from "../../../src/parser/TaskLineParser.js";
import { sort } from "../../../src/query/SortEngine.js";
import { sortCriterion } from "../../../src/query/SortCriterion.js";

/** 1:1 port of `PerliteCoreTests/SortEngineTests.swift`. */
function task(line: string) {
  return parseLine(line);
}

describe("SortEngine", () => {
  test("sorts by due date ascending with No date last", () => {
    const tasks = [task("- [ ] No date #task"), task("- [ ] Later #task 📅 2026-08-20"), task("- [ ] Earlier #task 📅 2026-08-13")];
    const sorted = sort(tasks, [sortCriterion("dueDate")]);
    expect(sorted.map((t) => t.description)).toEqual(["Earlier", "Later", "No date"]);
  });

  test("sorts by due date descending, still puts No date last", () => {
    const tasks = [task("- [ ] No date #task"), task("- [ ] Later #task 📅 2026-08-20"), task("- [ ] Earlier #task 📅 2026-08-13")];
    const sorted = sort(tasks, [sortCriterion("dueDate", "descending")]);
    expect(sorted.map((t) => t.description)).toEqual(["Later", "Earlier", "No date"]);
  });

  test("sorts by priority ascending is highest first", () => {
    const tasks = [task("- [ ] Normal #task"), task("- [ ] Highest #task 🔺"), task("- [ ] Lowest #task ⏬")];
    const sorted = sort(tasks, [sortCriterion("priority")]);
    expect(sorted.map((t) => t.description)).toEqual(["Highest", "Normal", "Lowest"]);
  });

  test("sorts by priority descending is lowest first", () => {
    const tasks = [task("- [ ] Normal #task"), task("- [ ] Highest #task 🔺"), task("- [ ] Lowest #task ⏬")];
    const sorted = sort(tasks, [sortCriterion("priority", "descending")]);
    expect(sorted.map((t) => t.description)).toEqual(["Lowest", "Normal", "Highest"]);
  });

  test("sorts by status active first", () => {
    const tasks = [task("- [x] Done #task"), task("- [ ] Todo #task"), task("- [-] Cancelled #task")];
    const sorted = sort(tasks, [sortCriterion("status")]);
    expect(sorted.map((t) => t.description)).toEqual(["Todo", "Done", "Cancelled"]);
  });

  test("sorts by description case-insensitively", () => {
    const tasks = [task("- [ ] banana #task"), task("- [ ] Apple #task"), task("- [ ] cherry #task")];
    const sorted = sort(tasks, [sortCriterion("description")]);
    expect(sorted.map((t) => t.description)).toEqual(["Apple", "banana", "cherry"]);
  });

  test("multi-level sort breaks ties with the second criterion", () => {
    // "priority then due date" — §6.7's own example.
    const tasks = [
      task("- [ ] High, later #task ⏫ 📅 2026-08-20"),
      task("- [ ] High, earlier #task ⏫ 📅 2026-08-13"),
      task("- [ ] Low #task 🔽 📅 2026-08-01"),
    ];
    const sorted = sort(tasks, [sortCriterion("priority"), sortCriterion("dueDate")]);
    expect(sorted.map((t) => t.description)).toEqual(["High, earlier", "High, later", "Low"]);
  });

  test("sort is stable when all criteria tie", () => {
    const tasks = [task("- [ ] First #task ⏫"), task("- [ ] Second #task ⏫"), task("- [ ] Third #task ⏫")];
    const sorted = sort(tasks, [sortCriterion("priority")]);
    expect(sorted.map((t) => t.description)).toEqual(["First", "Second", "Third"]);
  });

  test("an empty criteria list preserves original order", () => {
    const tasks = [task("- [ ] B #task"), task("- [ ] A #task")];
    const sorted = sort(tasks, []);
    expect(sorted.map((t) => t.description)).toEqual(["B", "A"]);
  });
});
