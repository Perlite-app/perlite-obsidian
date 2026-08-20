import { describe, expect, test } from "vitest";
import { computeChipSpecs, computeSourceContext, tokenizeDescription } from "../../../src/design/taskLineModel.js";
import type { ParsedTask } from "../../../src/model/ParsedTask.js";
import { createTaskTag } from "../../../src/model/TaskTag.js";
import { TASK_STATUS_TODO } from "../../../src/model/TaskStatus.js";

function makeTask(overrides: Partial<ParsedTask> = {}): ParsedTask {
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
    tags: [],
    inheritedTags: [],
    links: [],
    indentDepth: 0,
    spans: [],
    statusCharRange: { start: 0, end: 0 },
    bodyStart: 0,
    insertionPoint: 0,
    ...overrides,
  };
}

describe("computeSourceContext", () => {
  test("null when the task has no location", () => {
    expect(computeSourceContext(makeTask())).toBeNull();
  });

  test("bare note title when there's no parent heading — folder path stripped, just the filename", () => {
    const task = makeTask({ location: { filePath: "Projects/Groceries.md", lineIndex: 0 } });
    expect(computeSourceContext(task)).toBe("Groceries");
  });

  test("note title and heading, separated by ›", () => {
    const task = makeTask({
      location: { filePath: "Notes.md", lineIndex: 0 },
      parentHeading: "Home",
    });
    expect(computeSourceContext(task)).toBe("Notes › Home");
  });

  test("an empty (but present) heading falls back to the bare title", () => {
    const task = makeTask({ location: { filePath: "Notes.md", lineIndex: 0 }, parentHeading: "" });
    expect(computeSourceContext(task)).toBe("Notes");
  });

  test("strips every literal '.md' occurrence, matching the Swift original's own quirk verbatim — a lone '.' left between two matches is not itself part of either match", () => {
    // "my.md.file.md" = "my" + ".md" + "." + "file" + ".md" — both ".md" runs are
    // removed, but the single "." between them survives since it's never part of a
    // 3-character ".md" match on its own.
    const task = makeTask({ location: { filePath: "my.md.file.md", lineIndex: 0 } });
    expect(computeSourceContext(task)).toBe("my.file");
  });
});

describe("tokenizeDescription", () => {
  test("plain text with no tags splits into word tokens", () => {
    const task = makeTask({ description: "Buy milk and eggs" });
    expect(tokenizeDescription(task)).toEqual([
      { kind: "word", text: "Buy" },
      { kind: "word", text: "milk" },
      { kind: "word", text: "and" },
      { kind: "word", text: "eggs" },
    ]);
  });

  test("a recognised tag becomes a tag token", () => {
    const task = makeTask({ description: "Buy milk #errands", tags: [createTaskTag("#errands")] });
    expect(tokenizeDescription(task)).toEqual([
      { kind: "word", text: "Buy" },
      { kind: "word", text: "milk" },
      { kind: "tag", text: "#errands" },
    ]);
  });

  test("a nested tag renders as one whole chip, not a partial match of a shorter tag also present", () => {
    const task = makeTask({
      description: "#project and #project/sub",
      tags: [createTaskTag("#project"), createTaskTag("#project/sub")],
    });
    expect(tokenizeDescription(task)).toEqual([
      { kind: "tag", text: "#project" },
      { kind: "word", text: "and" },
      { kind: "tag", text: "#project/sub" },
    ]);
  });

  test("a tag-shaped token the parser did not recognise renders as a plain word", () => {
    // e.g. a `#define` that lived inside inline code — LineScanner never added it to
    // task.tags, so it must not become a chip here despite matching the shape regex.
    const task = makeTask({ description: "see #define here", tags: [] });
    expect(tokenizeDescription(task)).toEqual([
      { kind: "word", text: "see" },
      { kind: "word", text: "#define" },
      { kind: "word", text: "here" },
    ]);
  });

  test("the same tag appearing twice both become tag tokens", () => {
    const task = makeTask({ description: "#work stuff #work again", tags: [createTaskTag("#work")] });
    expect(tokenizeDescription(task)).toEqual([
      { kind: "tag", text: "#work" },
      { kind: "word", text: "stuff" },
      { kind: "tag", text: "#work" },
      { kind: "word", text: "again" },
    ]);
  });
});

describe("computeChipSpecs", () => {
  test("no chips for a bare task", () => {
    expect(computeChipSpecs(makeTask())).toEqual([]);
  });

  test("due chip, formatted as ISO", () => {
    const task = makeTask({ due: { kind: "valid", date: { year: 2026, month: 8, day: 13 } } });
    expect(computeChipSpecs(task)).toEqual([{ kind: "due", icon: "calendar", text: "2026-08-13" }]);
  });

  test("no priority chip for normal priority; a capitalized chip otherwise", () => {
    expect(computeChipSpecs(makeTask({ priority: "normal" }))).toEqual([]);
    expect(computeChipSpecs(makeTask({ priority: "high" }))).toEqual([
      { kind: "priority", icon: "flag", text: "High", priority: "high" },
    ]);
  });

  test("recurrence chip carries no text, icon only", () => {
    expect(computeChipSpecs(makeTask({ recurrenceRule: "every week" }))).toEqual([{ kind: "recurrence", icon: "repeat" }]);
  });

  test("subtask progress chip only appears when the caller supplies it", () => {
    expect(computeChipSpecs(makeTask())).toEqual([]);
    expect(computeChipSpecs(makeTask(), { done: 1, total: 3 })).toEqual([
      { kind: "subtasks", icon: "circle-check", text: "1/3" },
    ]);
  });

  test("all four chips together, in TaskRow's own order", () => {
    const task = makeTask({
      due: { kind: "valid", date: { year: 2026, month: 8, day: 13 } },
      priority: "low",
      recurrenceRule: "every day",
    });
    expect(computeChipSpecs(task, { done: 2, total: 2 })).toEqual([
      { kind: "due", icon: "calendar", text: "2026-08-13" },
      { kind: "priority", icon: "flag", text: "Low", priority: "low" },
      { kind: "recurrence", icon: "repeat" },
      { kind: "subtasks", icon: "circle-check", text: "2/2" },
    ]);
  });
});
