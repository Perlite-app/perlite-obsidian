import { describe, expect, test } from "vitest";
import { planVaultScan } from "../../../src/write/vaultScan.js";

describe("planVaultScan", () => {
  test("includes every file when there is nothing to exclude", () => {
    const plan = planVaultScan(["Groceries.md", "Work/Launch.md"], []);
    expect(plan.included).toEqual(["Groceries.md", "Work/Launch.md"]);
    expect(plan.conflictPaths).toEqual([]);
  });

  test("excludes files inside an excluded folder", () => {
    const plan = planVaultScan(["Groceries.md", "Archive/Old.md", "Archive/Nested/Deep.md"], ["Archive"]);
    expect(plan.included).toEqual(["Groceries.md"]);
  });

  test("a trailing slash on the configured folder is normalised", () => {
    const plan = planVaultScan(["Archive/Old.md"], ["Archive/"]);
    expect(plan.included).toEqual([]);
  });

  test("folder exclusion is a path-segment prefix, not a bare string prefix", () => {
    // "Archive" must not exclude "Archived.md" — that's a different file, not something
    // living inside the "Archive" folder.
    const plan = planVaultScan(["Archived.md", "Archive/Old.md"], ["Archive"]);
    expect(plan.included).toEqual(["Archived.md"]);
  });

  test("sync-conflict files are excluded from `included` and reported separately", () => {
    const plan = planVaultScan(
      ["Groceries.md", "Groceries.sync-conflict-20260814.md", "Notes (conflicted copy).md"],
      [],
    );
    expect(plan.included).toEqual(["Groceries.md"]);
    expect(plan.conflictPaths).toEqual(["Groceries.sync-conflict-20260814.md", "Notes (conflicted copy).md"]);
  });

  test("a conflict file inside an excluded folder is excluded entirely, not reported", () => {
    const plan = planVaultScan(["Archive/Old.sync-conflict-20260814.md"], ["Archive"]);
    expect(plan.included).toEqual([]);
    expect(plan.conflictPaths).toEqual([]);
  });
});
