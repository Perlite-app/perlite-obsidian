import { describe, expect, test } from "vitest";
import { PRIORITY_VALUES, priorityFromMarker, priorityMarker } from "../../../src/model/Priority.js";

describe("priorityMarker", () => {
  test("every non-normal priority has a marker", () => {
    expect(priorityMarker("highest")).toBe("🔺");
    expect(priorityMarker("high")).toBe("⏫");
    expect(priorityMarker("medium")).toBe("🔼");
    expect(priorityMarker("low")).toBe("🔽");
    expect(priorityMarker("lowest")).toBe("⏬");
  });

  test("normal has no marker", () => {
    expect(priorityMarker("normal")).toBeNull();
  });
});

describe("priorityFromMarker", () => {
  test("round-trips every marker back to its priority", () => {
    for (const priority of PRIORITY_VALUES) {
      const marker = priorityMarker(priority);
      if (marker === null) continue;
      expect(priorityFromMarker(marker)).toBe(priority);
    }
  });

  test("an unrecognised marker returns null", () => {
    expect(priorityFromMarker("🚀")).toBeNull();
  });
});

describe("PRIORITY_VALUES", () => {
  test("has exactly the six priorities, in the Swift CaseIterable declaration order", () => {
    expect(PRIORITY_VALUES).toEqual(["highest", "high", "medium", "normal", "low", "lowest"]);
  });
});
