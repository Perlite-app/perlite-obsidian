import { describe, expect, test } from "vitest";
import type { CalendarDate } from "../../../src/model/CalendarDate.js";
import { parseDocument } from "../../../src/parser/DocumentParser.js";
import { parseLine } from "../../../src/parser/TaskLineParser.js";
import * as BuiltInSmartLists from "../../../src/query/BuiltInSmartLists.js";
import {
  groupForList,
  lensCaptureDefaults,
  lensKey,
  lensMatches,
  lensTitle,
  parseLensKey,
  splitNotePath,
  upNext,
  type Lens,
} from "../../../src/query/lenses.js";

const TODAY: CalendarDate = { year: 2026, month: 10, day: 9 };

function task(line: string) {
  return parseLine(line);
}

function tasksIn(path: string, content: string) {
  return parseDocument(content, path).tasks;
}

describe("lens keys", () => {
  test.each<Lens>([
    { kind: "today" },
    { kind: "upcoming" },
    { kind: "noDate" },
    { kind: "high" },
    { kind: "all" },
    { kind: "tag", tag: "#work" },
    { kind: "note", path: "Work/Reviews.md" },
    { kind: "list", id: "user.abc" },
  ])("round-trips %o", (lens) => {
    expect(parseLensKey(lensKey(lens))).toEqual(lens);
  });

  test("an unknown key falls back to Today", () => {
    expect(parseLensKey("nonsense")).toEqual({ kind: "today" });
  });
});

describe("lensMatches", () => {
  test("Today: overdue and due-today open tasks, plus tasks completed today", () => {
    const today: Lens = { kind: "today" };
    expect(lensMatches(task("- [ ] Late #task 📅 2026-10-08"), today, TODAY, [])).toBe(true);
    expect(lensMatches(task("- [ ] Now #task 📅 2026-10-09"), today, TODAY, [])).toBe(true);
    expect(lensMatches(task("- [/] Doing #task ⏳ 2026-10-09"), today, TODAY, [])).toBe(true);
    expect(lensMatches(task("- [ ] Later #task 📅 2026-10-12"), today, TODAY, [])).toBe(false);
    expect(lensMatches(task("- [x] Finished #task 📅 2026-10-09 ✅ 2026-10-09"), today, TODAY, [])).toBe(true);
    expect(lensMatches(task("- [x] Old #task 📅 2026-10-07 ✅ 2026-10-07"), today, TODAY, [])).toBe(false);
    expect(lensMatches(task("- [-] Dropped #task 📅 2026-10-09"), today, TODAY, [])).toBe(false);
  });

  test("High priority: open high and highest only", () => {
    const high: Lens = { kind: "high" };
    expect(lensMatches(task("- [ ] A #task ⏫"), high, TODAY, [])).toBe(true);
    expect(lensMatches(task("- [ ] B #task 🔺"), high, TODAY, [])).toBe(true);
    expect(lensMatches(task("- [ ] C #task 🔼"), high, TODAY, [])).toBe(false);
    expect(lensMatches(task("- [x] D #task ⏫"), high, TODAY, [])).toBe(false);
  });

  test("tag lens matches case-insensitively", () => {
    expect(lensMatches(task("- [ ] A #task #Work"), { kind: "tag", tag: "#work" }, TODAY, [])).toBe(true);
    expect(lensMatches(task("- [ ] A #task #home"), { kind: "tag", tag: "#work" }, TODAY, [])).toBe(false);
  });

  test("note lens matches the task's own file", () => {
    const [inNote] = tasksIn("Work/Reviews.md", "- [ ] A #task\n");
    expect(lensMatches(inNote!, { kind: "note", path: "Work/Reviews.md" }, TODAY, [])).toBe(true);
    expect(lensMatches(inNote!, { kind: "note", path: "Home.md" }, TODAY, [])).toBe(false);
  });

  test("cancelled tasks only with includeCancelled, and only on narrow lenses", () => {
    const cancelled = task("- [-] Dropped #task #work 📅 2026-10-09");
    expect(lensMatches(cancelled, { kind: "tag", tag: "#work" }, TODAY, [])).toBe(false);
    expect(lensMatches(cancelled, { kind: "tag", tag: "#work" }, TODAY, [], { includeCancelled: true })).toBe(true);
    expect(lensMatches(cancelled, { kind: "today" }, TODAY, [], { includeCancelled: true })).toBe(false);
  });

  test("list lens evaluates the smart list's own filter", () => {
    const lists = [BuiltInSmartLists.flagged];
    const lens: Lens = { kind: "list", id: BuiltInSmartLists.flagged.id };
    expect(lensMatches(task("- [ ] A #task ⏫"), lens, TODAY, lists)).toBe(true);
    expect(lensMatches(task("- [ ] A #task"), lens, TODAY, lists)).toBe(false);
    expect(lensTitle(lens, lists)).toBe(BuiltInSmartLists.flagged.name);
  });
});

describe("upNext and grouping", () => {
  const tasks = tasksIn(
    "Ops/Infra.md",
    ["- [ ] Renew TLS #task ⏫ 📅 2026-10-08", "- [ ] Rotate keys #task 🔺 📅 2026-10-12", "- [x] Old #task ✅ 2026-10-09"].join("\n"),
  ).concat(tasksIn("Work/Reviews.md", "- [ ] Reply #task 🔼 📅 2026-10-09\n- [ ] Merge #task\n"));

  test("overdue beats a higher priority that isn't overdue", () => {
    expect(upNext(tasks, TODAY)?.description).toContain("Renew TLS");
  });

  test("group by note keeps first-appearance order and the folder as a prefix", () => {
    const groups = groupForList(tasks, "note", TODAY);
    expect(groups.map((group) => [group.prefix, group.title])).toEqual([
      ["Ops/", "Infra"],
      ["Work/", "Reviews"],
    ]);
    expect(groups[0]!.tasks.at(-1)!.status.kind).toBe("done");
  });

  test("group by due buckets overdue, today, later, none", () => {
    expect(groupForList(tasks, "due", TODAY).map((group) => group.title)).toEqual(["Overdue", "Due today", "Later", "No due date"]);
  });

  test("group by priority drops empty levels", () => {
    expect(groupForList(tasks, "priority", TODAY).map((group) => group.key)).toEqual(["highest", "high", "medium", "normal"]);
  });
});

describe("helpers", () => {
  test("splitNotePath", () => {
    expect(splitNotePath("Work/Reviews.md")).toEqual({ folder: "Work/", note: "Reviews" });
    expect(splitNotePath("Reading.md")).toEqual({ folder: "", note: "Reading" });
  });

  test("capture defaults follow the lens", () => {
    expect(lensCaptureDefaults({ kind: "today" }).dueToday).toBe(true);
    expect(lensCaptureDefaults({ kind: "high" }).priority).toBe("high");
    expect(lensCaptureDefaults({ kind: "tag", tag: "#work" }).tag).toBe("#work");
    expect(lensCaptureDefaults({ kind: "note", path: "Work/Admin.md" }).destination).toBe("Work/Admin.md");
    expect(lensCaptureDefaults({ kind: "all" })).toEqual({ dueToday: false, priority: null, tag: null, destination: null });
  });
});
