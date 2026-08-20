import { describe, expect, test } from "vitest";
import * as BuiltInSmartLists from "../../../src/query/BuiltInSmartLists.js";
import type { FilterCriterion, FilterExpression } from "../../../src/query/FilterCriterion.js";
import { createSmartList, type SmartList } from "../../../src/query/SmartList.js";
import { sortCriterion } from "../../../src/query/SortCriterion.js";
import {
  decodeCalendarDate,
  decodeDateRangeFilter,
  decodeFilterCriterion,
  decodeFilterExpression,
  decodeSmartList,
  encodeCalendarDate,
  encodeFilterCriterion,
  encodeFilterExpression,
  encodeSmartList,
  QueryCodingError,
} from "../../../src/query/queryCoding.js";

/** 1:1 port of `PerliteCoreTests/QueryCodingTests.swift` — same coverage, but see
 * `queryCoding.ts`'s own doc comment for why the golden test here pins parsed shape
 * rather than an exact sorted-key string. */

function roundTripSmartList(list: SmartList): SmartList {
  return decodeSmartList(JSON.parse(JSON.stringify(encodeSmartList(list))));
}

describe("queryCoding", () => {
  test("every built-in smart list round-trips unchanged", () => {
    for (const list of BuiltInSmartLists.all) {
      expect(roundTripSmartList(list)).toEqual(list);
    }
  });

  test("a nested and/or/not expression round-trips", () => {
    const expression: FilterExpression = {
      type: "or",
      expressions: [
        {
          type: "and",
          expressions: [
            { type: "criterion", criterion: { type: "tagExact", tag: "#work" } },
            { type: "not", expression: { type: "criterion", criterion: { type: "status", kind: "done" } } },
          ],
        },
        { type: "criterion", criterion: { type: "priority", value: "highest" } },
      ],
    };
    const decoded = decodeFilterExpression(JSON.parse(JSON.stringify(encodeFilterExpression(expression))));
    expect(decoded).toEqual(expression);
  });

  test("every FilterCriterion case round-trips", () => {
    const criteria: FilterCriterion[] = [
      { type: "status", kind: "todo" },
      { type: "status", kind: "done" },
      { type: "status", kind: "cancelled" },
      { type: "status", kind: "custom" },
      { type: "priority", value: "highest" },
      { type: "priority", value: "normal" },
      { type: "dueDate", range: { type: "none" } },
      { type: "dueDate", range: { type: "before", date: { year: 2026, month: 8, day: 17 } } },
      { type: "dueDate", range: { type: "onOrAfter", date: { year: 2026, month: 8, day: 17 } } },
      { type: "dueDate", range: { type: "between", start: { year: 2026, month: 8, day: 1 }, end: { year: 2026, month: 8, day: 31 } } },
      { type: "dueDate", range: { type: "relative", value: "overdue" } },
      { type: "dueDate", range: { type: "relative", value: "today" } },
      { type: "dueDate", range: { type: "relative", value: "next7Days" } },
      { type: "dueDate", range: { type: "relative", value: "last7Days" } },
      { type: "scheduledDate", range: { type: "relative", value: "today" } },
      { type: "startDate", range: { type: "relative", value: "today" } },
      { type: "doneDate", range: { type: "relative", value: "last7Days" } },
      { type: "tagExact", tag: "#work" },
      { type: "tagContains", text: "wor" },
      { type: "pathContains", text: "Projects/" },
      { type: "textContains", text: "groceries" },
      { type: "hasDescription", value: true },
      { type: "hasDescription", value: false },
    ];
    for (const criterion of criteria) {
      const decoded = decodeFilterCriterion(JSON.parse(JSON.stringify(encodeFilterCriterion(criterion))));
      expect(decoded).toEqual(criterion);
    }
  });

  /** Pins the exact wire shape for one representative expression — deliberately not
   * resilient to a field being renamed or a discriminator value changing. See
   * `queryCoding.ts`'s doc comment for why this compares parsed shape, not a raw
   * string, unlike the Swift original's sorted-key golden string. */
  test("golden shape for a nested expression", () => {
    const expression: FilterExpression = {
      type: "and",
      expressions: [
        { type: "criterion", criterion: { type: "tagExact", tag: "#work" } },
        { type: "not", expression: { type: "criterion", criterion: { type: "status", kind: "done" } } },
        { type: "criterion", criterion: { type: "dueDate", range: { type: "relative", value: "next7Days" } } },
      ],
    };
    const encoded = JSON.parse(JSON.stringify(encodeFilterExpression(expression)));
    expect(encoded).toEqual({
      type: "and",
      expressions: [
        { type: "criterion", criterion: { type: "tagExact", tag: "#work" } },
        { type: "not", expression: { type: "criterion", criterion: { type: "status", kind: "done" } } },
        { type: "criterion", criterion: { type: "dueDate", range: { type: "relative", value: "next7Days" } } },
      ],
    });
  });

  test("CalendarDate encodes as an ISO string and rejects malformed input", () => {
    expect(encodeCalendarDate({ year: 2026, month: 8, day: 17 })).toBe("2026-08-17");
    expect(() => decodeCalendarDate("not-a-date")).toThrow(QueryCodingError);
  });

  test("an unrecognised discriminator throws rather than silently dropping data", () => {
    const corrupt = { type: "somethingFutureVersionAdded" };
    expect(() => decodeFilterCriterion(corrupt)).toThrow(QueryCodingError);
    expect(() => decodeFilterExpression(corrupt)).toThrow(QueryCodingError);
    expect(() => decodeDateRangeFilter(corrupt)).toThrow(QueryCodingError);
  });

  test("a smart list with grouping and a multi-level sort round-trips", () => {
    const list = createSmartList({
      id: "user.test-id",
      name: "My Work",
      icon: "flag",
      accentToken: "accent.blue",
      filter: {
        type: "and",
        expressions: [
          { type: "criterion", criterion: { type: "tagExact", tag: "#work" } },
          { type: "not", expression: { type: "criterion", criterion: { type: "status", kind: "done" } } },
        ],
      },
      grouping: "priority",
      sorting: [sortCriterion("priority"), sortCriterion("dueDate", "descending")],
      isBuiltIn: false,
    });
    expect(roundTripSmartList(list)).toEqual(list);
  });
});
