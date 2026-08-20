import { describe, expect, test } from "vitest";
import * as BuiltInSmartLists from "../../../src/query/BuiltInSmartLists.js";
import { createSmartList, type SmartList } from "../../../src/query/SmartList.js";
import { mergeSmartListCatalog } from "../../../src/query/smartListCatalog.js";
import { EMPTY_STORED_SMART_LISTS, type StoredSmartLists } from "../../../src/query/StoredSmartLists.js";

/** 1:1 port of `SmartListCatalogTests.swift`. */
function userList(id: string): SmartList {
  return createSmartList({
    id,
    name: id,
    icon: "flag",
    accentToken: "accent.blue",
    filter: { type: "criterion", criterion: { type: "priority", value: "high" } },
  });
}

describe("mergeSmartListCatalog", () => {
  test("an empty store returns exactly the built-ins, in their own order", () => {
    const all = mergeSmartListCatalog(EMPTY_STORED_SMART_LISTS);
    expect(all.map((l) => l.id)).toEqual(BuiltInSmartLists.all.map((l) => l.id));
  });

  test("an explicit order interleaves built-ins and user lists", () => {
    const user = userList("user.a");
    const stored: StoredSmartLists = {
      schemaVersion: 1,
      lists: [user],
      order: ["builtin.flagged", "user.a", "builtin.today"],
      pinnedIDs: [],
      hiddenBuiltInIDs: [],
    };
    const all = mergeSmartListCatalog(stored);
    // Every id named in `order` leads, in that exact sequence; any built-in not
    // mentioned (there are four others) is appended afterward, not dropped.
    expect(all.slice(0, 3).map((l) => l.id)).toEqual(["builtin.flagged", "user.a", "builtin.today"]);
    expect(all).toHaveLength(BuiltInSmartLists.all.length + 1);
  });

  test("ids missing from order are appended rather than dropped", () => {
    const user = userList("user.a");
    const stored: StoredSmartLists = {
      schemaVersion: 1,
      lists: [user],
      order: ["builtin.overdue"],
      pinnedIDs: [],
      hiddenBuiltInIDs: [],
    };
    const all = mergeSmartListCatalog(stored);
    expect(all[0]?.id).toBe("builtin.overdue");
    expect(new Set(all.map((l) => l.id))).toEqual(new Set([...BuiltInSmartLists.all.map((l) => l.id), "user.a"]));
    expect(all).toHaveLength(BuiltInSmartLists.all.length + 1);
  });

  test("hidden built-ins are still included in the catalog", () => {
    // Hiding is a hub-rendering concern only — every built-in id must stay resolvable
    // here (a deep link and its detail view both depend on it).
    const stored: StoredSmartLists = {
      schemaVersion: 1,
      lists: [],
      order: [],
      pinnedIDs: [],
      hiddenBuiltInIDs: ["builtin.flagged"],
    };
    const all = mergeSmartListCatalog(stored);
    expect(all.some((l) => l.id === "builtin.flagged")).toBe(true);
  });

  test("a duplicate id in order is not duplicated in the result", () => {
    const stored: StoredSmartLists = {
      schemaVersion: 1,
      lists: [],
      order: ["builtin.today", "builtin.today"],
      pinnedIDs: [],
      hiddenBuiltInIDs: [],
    };
    const all = mergeSmartListCatalog(stored);
    expect(all.filter((l) => l.id === "builtin.today")).toHaveLength(1);
  });
});
