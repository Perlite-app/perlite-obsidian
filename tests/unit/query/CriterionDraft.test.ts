import { describe, expect, test } from "vitest";
import {
  createCriterionDraft,
  criterionDraftFromCriterion,
  criterionDraftToCriterion,
  flatFilterFromExpression,
  flatFilterToExpression,
} from "../../../src/query/CriterionDraft.js";
import type { FilterCriterion, FilterExpression } from "../../../src/query/FilterCriterion.js";

/** 1:1 port of `PerliteTests/CriterionDraftTests.swift`. */

describe("CriterionDraft", () => {
  test("every criterion round-trips through a draft unchanged", () => {
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
      const draft = criterionDraftFromCriterion(criterion);
      expect(criterionDraftToCriterion(draft)).toEqual(criterion);
    }
  });

  test("negation round-trips through a not-wrapped criterion", () => {
    // `flatFilterToExpression` always emits a canonical `and`/`or` wrapper, even for a
    // single row — so a bare top-level `not(criterion)` (never something this editor
    // itself would produce; only a hand-built or pre-flat-editor fixture) round-trips as
    // `and([not(criterion)])`, not byte-identical but semantically equivalent.
    const expression: FilterExpression = { type: "not", expression: { type: "criterion", criterion: { type: "status", kind: "done" } } };
    const filter = flatFilterFromExpression(expression);
    expect(filter).not.toBeNull();
    expect(filter?.rows[0]?.isNegated).toBe(true);
    expect(flatFilterToExpression(filter!)).toEqual({ type: "and", expressions: [expression] });
  });

  test("a flat and-expression round-trips", () => {
    const expression: FilterExpression = {
      type: "and",
      expressions: [
        { type: "criterion", criterion: { type: "tagExact", tag: "#work" } },
        { type: "not", expression: { type: "criterion", criterion: { type: "status", kind: "done" } } },
        { type: "criterion", criterion: { type: "dueDate", range: { type: "relative", value: "next7Days" } } },
      ],
    };
    const filter = flatFilterFromExpression(expression);
    expect(filter?.mode).toBe("all");
    expect(flatFilterToExpression(filter!)).toEqual(expression);
  });

  test("a flat or-expression round-trips", () => {
    const expression: FilterExpression = {
      type: "or",
      expressions: [
        { type: "criterion", criterion: { type: "priority", value: "highest" } },
        { type: "criterion", criterion: { type: "priority", value: "high" } },
      ],
    };
    const filter = flatFilterFromExpression(expression);
    expect(filter?.mode).toBe("any");
    expect(flatFilterToExpression(filter!)).toEqual(expression);
  });

  test("a single criterion with no wrapper is representable", () => {
    const expression: FilterExpression = { type: "criterion", criterion: { type: "priority", value: "highest" } };
    const filter = flatFilterFromExpression(expression);
    expect(filter).not.toBeNull();
    expect(filter?.rows).toHaveLength(1);
  });

  test("nested groups are not representable in the flat editor", () => {
    // (#work AND high) OR (#home AND overdue) — mixes AND and OR, so it cannot be shown
    // as a single Match-All/Any list without changing its meaning.
    const expression: FilterExpression = {
      type: "or",
      expressions: [
        { type: "and", expressions: [{ type: "criterion", criterion: { type: "tagExact", tag: "#work" } }, { type: "criterion", criterion: { type: "priority", value: "high" } }] },
        {
          type: "and",
          expressions: [
            { type: "criterion", criterion: { type: "tagExact", tag: "#home" } },
            { type: "criterion", criterion: { type: "dueDate", range: { type: "relative", value: "overdue" } } },
          ],
        },
      ],
    };
    expect(flatFilterFromExpression(expression)).toBeNull();
  });

  test("a doubly-negated criterion is not representable", () => {
    const expression: FilterExpression = {
      type: "not",
      expression: { type: "not", expression: { type: "criterion", criterion: { type: "status", kind: "done" } } },
    };
    expect(flatFilterFromExpression(expression)).toBeNull();
  });

  test("an empty and/or is not representable", () => {
    expect(flatFilterFromExpression({ type: "and", expressions: [] })).toBeNull();
    expect(flatFilterFromExpression({ type: "or", expressions: [] })).toBeNull();
  });

  test("a missing leading # is added to a tagExact criterion", () => {
    const draft = createCriterionDraft("tagExact");
    draft.text = "work";
    expect(criterionDraftToCriterion(draft)).toEqual({ type: "tagExact", tag: "#work" });
  });
});
