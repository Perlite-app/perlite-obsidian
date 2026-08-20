import { describe, expect, test } from "vitest";
import { createTaskTag } from "../../../src/model/TaskTag.js";
import { parseLine } from "../../../src/parser/TaskLineParser.js";
import { group } from "../../../src/query/GroupingEngine.js";

/** 1:1 port of `PerliteCoreTests/GroupingEngineTests.swift`. */
function task(line: string, path?: string) {
  return parseLine(line, path !== undefined ? { location: { filePath: path, lineIndex: 0 } } : undefined);
}

describe("GroupingEngine", () => {
  test("groups by due date chronologically with No date last", () => {
    const tasks = [task("- [ ] No date #task"), task("- [ ] Later #task 📅 2026-08-20"), task("- [ ] Earlier #task 📅 2026-08-13")];
    const groups = group(tasks, "dueDate");
    expect(groups.map((g) => g.key)).toEqual(["2026-08-13", "2026-08-20", "No date"]);
  });

  test("groups by due date puts invalid dates after valid ones and before No date", () => {
    const tasks = [task("- [ ] No date #task"), task("- [ ] Malformed #task 📅 2026-13-45"), task("- [ ] Valid #task 📅 2026-08-13")];
    const groups = group(tasks, "dueDate");
    expect(groups.map((g) => g.key)).toEqual(["2026-08-13", "Invalid: 2026-13-45", "No date"]);
  });

  test("groups by priority highest to lowest, skipping empty buckets", () => {
    const tasks = [task("- [ ] Low #task 🔽"), task("- [ ] Highest #task 🔺"), task("- [ ] Normal #task")];
    const groups = group(tasks, "priority");
    expect(groups.map((g) => g.key)).toEqual(["highest", "normal", "low"]);
  });

  test("groups by tag fans out multi-tag tasks and buckets untagged last", () => {
    const multiTag = task("- [ ] Both #task #work #urgent");
    const untagged = task("- [ ] None #task");
    const groups = group([multiTag, untagged], "tag");
    expect(groups.map((g) => g.key)).toEqual(["#urgent", "#work", "No tags"]);
    expect(groups.find((g) => g.key === "#urgent")?.tasks).toHaveLength(1);
    expect(groups.find((g) => g.key === "#work")?.tasks).toHaveLength(1);
  });

  test("groups by tag includes inherited tags", () => {
    const inherited = parseLine("- [ ] Task #task", { inheritedTags: [createTaskTag("#work")] });
    const groups = group([inherited], "tag");
    expect(groups.map((g) => g.key)).toEqual(["#work"]);
  });

  test("groups by file alphabetically with Unknown last", () => {
    const tasks = [task("- [ ] No location #task"), task("- [ ] In Z #task", "z.md"), task("- [ ] In A #task", "a.md")];
    const groups = group(tasks, "file");
    expect(groups.map((g) => g.key)).toEqual(["a.md", "z.md", "Unknown"]);
  });

  test("groups by folder treats a top-level file as an empty folder", () => {
    const tasks = [task("- [ ] Root file #task", "inbox.md"), task("- [ ] Nested #task", "Projects/roadmap.md")];
    const groups = group(tasks, "folder");
    expect(groups.map((g) => g.key)).toEqual(["", "Projects"]);
  });

  test("groups by status in active-before-terminal order", () => {
    const tasks = [task("- [x] Done #task"), task("- [ ] Todo #task"), task("- [/] Custom #task"), task("- [-] Cancelled #task")];
    const groups = group(tasks, "status");
    expect(groups.map((g) => g.key)).toEqual(["todo", "custom", "done", "cancelled"]);
  });

  test("empty input produces no groups", () => {
    expect(group([], "priority")).toEqual([]);
  });
});
