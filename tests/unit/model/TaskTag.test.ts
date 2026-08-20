import { describe, expect, test } from "vitest";
import { createTaskTag, taskTagNormalizedKey } from "../../../src/model/TaskTag.js";

describe("createTaskTag", () => {
  test("accepts a leading-# tag", () => {
    expect(createTaskTag("#errands")).toEqual({ raw: "#errands" });
  });

  test("accepts a nested tag", () => {
    expect(createTaskTag("#project/sub")).toEqual({ raw: "#project/sub" });
  });

  test("throws when the leading # is missing", () => {
    expect(() => createTaskTag("errands")).toThrow("TaskTag.raw must include the leading #");
  });
});

describe("taskTagNormalizedKey", () => {
  test("lowercases for case-insensitive dedupe", () => {
    expect(taskTagNormalizedKey(createTaskTag("#Errands"))).toBe("#errands");
  });

  test("two different-case tags normalize to the same key", () => {
    expect(taskTagNormalizedKey(createTaskTag("#Work"))).toBe(taskTagNormalizedKey(createTaskTag("#work")));
  });
});
