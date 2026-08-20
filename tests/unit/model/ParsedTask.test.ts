import { describe, expect, test } from "vitest";
import { allTags, type ParsedTask } from "../../../src/model/ParsedTask.js";
import { createTaskTag } from "../../../src/model/TaskTag.js";
import { TASK_STATUS_TODO } from "../../../src/model/TaskStatus.js";

/** A minimal, otherwise-empty ParsedTask — only `tags`/`inheritedTags` vary per test.
 * No parser exists yet (Wave 1 chunk 2), so this is hand-built rather than produced by
 * parsing a real line, same as the Swift side's own unit tests do for pre-parser-era
 * model-only coverage. */
function makeTask(tags: string[], inheritedTags: string[]): ParsedTask {
  return {
    raw: "",
    location: null,
    indent: "",
    listMarker: "- ",
    status: TASK_STATUS_TODO,
    description: "",
    due: null,
    scheduled: null,
    start: null,
    created: null,
    done: null,
    cancelled: null,
    reminder: null,
    priority: "normal",
    recurrenceRule: null,
    onCompletion: null,
    id: null,
    blockedBy: [],
    parentHeading: null,
    tags: tags.map(createTaskTag),
    inheritedTags: inheritedTags.map(createTaskTag),
    links: [],
    indentDepth: 0,
    spans: [],
    statusCharRange: { start: 0, end: 0 },
    bodyStart: 0,
    insertionPoint: 0,
  };
}

describe("allTags", () => {
  test("with no inherited tags, returns tags unchanged", () => {
    const task = makeTask(["#work"], []);
    expect(allTags(task).map((t) => t.raw)).toEqual(["#work"]);
  });

  test("merges inherited tags not already present", () => {
    const task = makeTask(["#work"], ["#urgent", "#home"]);
    expect(allTags(task).map((t) => t.raw)).toEqual(["#work", "#urgent", "#home"]);
  });

  test("case-insensitive dedupe: the task's own casing wins", () => {
    const task = makeTask(["#Home"], ["#home", "#urgent"]);
    expect(allTags(task).map((t) => t.raw)).toEqual(["#Home", "#urgent"]);
  });
});
