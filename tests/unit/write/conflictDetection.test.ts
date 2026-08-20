import { describe, expect, test } from "vitest";
import { isSyncConflictPath } from "../../../src/write/conflictDetection.js";

describe("isSyncConflictPath", () => {
  test("recognises iCloud Drive's naming", () => {
    expect(isSyncConflictPath("Notes/Groceries.sync-conflict-20260814-120000.md")).toBe(true);
  });

  test("recognises Dropbox/Google Drive's naming", () => {
    expect(isSyncConflictPath("Notes/Groceries (conflicted copy 2026-08-14).md")).toBe(true);
  });

  test("an ordinary path is not a conflict", () => {
    expect(isSyncConflictPath("Notes/Groceries.md")).toBe(false);
  });
});
