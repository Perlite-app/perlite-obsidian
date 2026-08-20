import { describe, expect, test } from "vitest";
import { createTaskStatus, TASK_STATUS_CANCELLED, TASK_STATUS_DONE, TASK_STATUS_TODO } from "../../../src/model/TaskStatus.js";

describe("createTaskStatus", () => {
  test("classifies well-known symbols", () => {
    expect(createTaskStatus(" ")).toEqual({ symbol: " ", kind: "todo" });
    expect(createTaskStatus("x")).toEqual({ symbol: "x", kind: "done" });
    expect(createTaskStatus("X")).toEqual({ symbol: "X", kind: "done" });
    expect(createTaskStatus("-")).toEqual({ symbol: "-", kind: "cancelled" });
  });

  test("any other symbol classifies as custom, preserving the exact symbol", () => {
    expect(createTaskStatus("/")).toEqual({ symbol: "/", kind: "custom" });
    expect(createTaskStatus("!")).toEqual({ symbol: "!", kind: "custom" });
  });
});

describe("well-known constants", () => {
  test("match createTaskStatus for the same symbols", () => {
    expect(TASK_STATUS_TODO).toEqual(createTaskStatus(" "));
    expect(TASK_STATUS_DONE).toEqual(createTaskStatus("x"));
    expect(TASK_STATUS_CANCELLED).toEqual(createTaskStatus("-"));
  });
});
