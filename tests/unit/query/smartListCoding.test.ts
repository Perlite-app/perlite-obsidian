import { describe, expect, test } from "vitest";
import { createSmartList } from "../../../src/query/SmartList.js";
import { decodeStoredSmartLists, encodeStoredSmartLists } from "../../../src/query/smartListCoding.js";
import { EMPTY_STORED_SMART_LISTS, type StoredSmartLists } from "../../../src/query/StoredSmartLists.js";

function roundTrip(stored: StoredSmartLists): StoredSmartLists {
  return decodeStoredSmartLists(JSON.parse(JSON.stringify(encodeStoredSmartLists(stored))));
}

describe("smartListCoding", () => {
  test("the empty store round-trips unchanged", () => {
    expect(roundTrip(EMPTY_STORED_SMART_LISTS)).toEqual(EMPTY_STORED_SMART_LISTS);
  });

  test("a store with user-defined lists, order, pins, and hidden built-ins round-trips", () => {
    const list = createSmartList({
      id: "user.work",
      name: "Work",
      icon: "flag",
      accentToken: "accent.blue",
      filter: { type: "criterion", criterion: { type: "tagExact", tag: "#work" } },
    });
    const stored: StoredSmartLists = {
      schemaVersion: 1,
      lists: [list],
      order: ["builtin.today", "user.work"],
      pinnedIDs: ["builtin.today"],
      hiddenBuiltInIDs: ["builtin.anytime"],
    };
    expect(roundTrip(stored)).toEqual(stored);
  });

  test("decoding rejects a non-object value", () => {
    expect(() => decodeStoredSmartLists("not an object")).toThrow();
    expect(() => decodeStoredSmartLists(null)).toThrow();
    expect(() => decodeStoredSmartLists([1, 2, 3])).toThrow();
  });

  test("decoding rejects a missing lists array", () => {
    expect(() => decodeStoredSmartLists({ order: [], pinnedIDs: [], hiddenBuiltInIDs: [] })).toThrow();
  });

  test("decoding falls back to the current schema version when it's missing", () => {
    const decoded = decodeStoredSmartLists({ lists: [], order: [], pinnedIDs: [], hiddenBuiltInIDs: [] });
    expect(decoded.schemaVersion).toBe(1);
  });
});
