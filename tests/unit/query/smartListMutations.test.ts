import { describe, expect, test } from "vitest";
import * as BuiltInSmartLists from "../../../src/query/BuiltInSmartLists.js";
import { createSmartList } from "../../../src/query/SmartList.js";
import { mergeSmartListCatalog } from "../../../src/query/smartListCatalog.js";
import {
  isBuiltInID,
  withCreatedList,
  withDeletedList,
  withMovedList,
  withNormalizedOrder,
  withToggledHiddenBuiltIn,
  withUpdatedList,
} from "../../../src/query/smartListMutations.js";
import { EMPTY_STORED_SMART_LISTS, type StoredSmartLists } from "../../../src/query/StoredSmartLists.js";

function userList(id: string, name = id) {
  return createSmartList({
    id,
    name,
    icon: "flag",
    accentToken: "smartlist.today",
    filter: { type: "criterion", criterion: { type: "priority", value: "high" } },
  });
}

describe("smartListMutations", () => {
  test("withCreatedList appends the list and its id to order", () => {
    const list = userList("user.a");
    const stored = withCreatedList(EMPTY_STORED_SMART_LISTS, list);
    expect(stored.lists).toEqual([list]);
    expect(stored.order[stored.order.length - 1]).toBe("user.a");
    expect(stored.order).toHaveLength(BuiltInSmartLists.all.length + 1);
  });

  test("withUpdatedList replaces a list by id, leaving others untouched", () => {
    const original = userList("user.a", "Original");
    const stored = withCreatedList(EMPTY_STORED_SMART_LISTS, original);
    const renamed = { ...original, name: "Renamed" };
    const updated = withUpdatedList(stored, renamed);
    expect(updated.lists).toEqual([renamed]);
  });

  test("withDeletedList removes the list from lists, order, and pinnedIDs", () => {
    const list = userList("user.a");
    let stored = withCreatedList(EMPTY_STORED_SMART_LISTS, list);
    stored = { ...stored, pinnedIDs: ["user.a"] };
    const deleted = withDeletedList(stored, "user.a");
    expect(deleted.lists).toEqual([]);
    expect(deleted.order).not.toContain("user.a");
    expect(deleted.pinnedIDs).toEqual([]);
  });

  test("withToggledHiddenBuiltIn adds then removes an id", () => {
    const hidden = withToggledHiddenBuiltIn(EMPTY_STORED_SMART_LISTS, "builtin.anytime");
    expect(hidden.hiddenBuiltInIDs).toEqual(["builtin.anytime"]);
    const shown = withToggledHiddenBuiltIn(hidden, "builtin.anytime");
    expect(shown.hiddenBuiltInIDs).toEqual([]);
  });

  test("withMovedList swaps a list with its neighbour", () => {
    const stored: StoredSmartLists = { ...EMPTY_STORED_SMART_LISTS, order: BuiltInSmartLists.all.map((l) => l.id) };
    const moved = withMovedList(stored, "builtin.overdue", "up");
    // "overdue" is index 1 in BuiltInSmartLists.all — moving up swaps it with "today".
    expect(moved.order[0]).toBe("builtin.overdue");
    expect(moved.order[1]).toBe("builtin.today");
  });

  test("withMovedList at either boundary is a no-op", () => {
    const stored: StoredSmartLists = { ...EMPTY_STORED_SMART_LISTS, order: BuiltInSmartLists.all.map((l) => l.id) };
    const first = BuiltInSmartLists.all[0]!.id;
    const last = BuiltInSmartLists.all[BuiltInSmartLists.all.length - 1]!.id;
    expect(withMovedList(stored, first, "up").order).toEqual(stored.order);
    expect(withMovedList(stored, last, "down").order).toEqual(stored.order);
  });

  test("withMovedList on an unknown id is a no-op", () => {
    expect(withMovedList(EMPTY_STORED_SMART_LISTS, "does.not.exist", "up")).toBe(EMPTY_STORED_SMART_LISTS);
  });

  test("withNormalizedOrder writes a complete order derived from the merged catalog", () => {
    const stored = withNormalizedOrder(EMPTY_STORED_SMART_LISTS);
    expect(stored.order).toEqual(mergeSmartListCatalog(EMPTY_STORED_SMART_LISTS).map((l) => l.id));
  });

  test("isBuiltInID distinguishes built-in from user ids", () => {
    expect(isBuiltInID("builtin.today")).toBe(true);
    expect(isBuiltInID("user.anything")).toBe(false);
  });
});
