import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createDebouncer } from "../../../src/write/debounce.js";

describe("createDebouncer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("fires once, after the delay, with the latest arguments", () => {
    const calls: string[] = [];
    const debouncer = createDebouncer<[string]>((value) => calls.push(value), 500);

    debouncer.schedule("a");
    vi.advanceTimersByTime(200);
    debouncer.schedule("b");
    vi.advanceTimersByTime(200);
    debouncer.schedule("c");
    expect(calls).toEqual([]);

    vi.advanceTimersByTime(500);
    expect(calls).toEqual(["c"]);
  });

  test("cancel prevents a pending call from firing", () => {
    const calls: string[] = [];
    const debouncer = createDebouncer<[string]>((value) => calls.push(value), 500);

    debouncer.schedule("a");
    debouncer.cancel();
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual([]);
  });

  test("cancel with nothing pending is a no-op", () => {
    const debouncer = createDebouncer(() => {}, 500);
    expect(() => debouncer.cancel()).not.toThrow();
  });
});
