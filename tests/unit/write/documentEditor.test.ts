import { describe, expect, test } from "vitest";
import { splitLines } from "../../../src/parser/DocumentParser.js";
import {
  appendEdit,
  applyEdit,
  deleteEdit,
  DocumentEditError,
  inverseEdit,
  type DocumentEdit,
  type LineDocument,
} from "../../../src/write/documentEditor.js";

/** 1:1 port of `PerliteCoreTests/DocumentEditorTests.swift` — same cases, same order. */

function document(content: string): LineDocument {
  return { lines: splitLines(content) };
}

describe("applyEdit", () => {
  test("replace only changes the target line", () => {
    const doc = document("- [ ] One #task\n- [ ] Two #task\n- [ ] Three #task\n");
    const edit: DocumentEdit = { locate: "- [ ] Two #task", replacement: "- [x] Two #task" };
    expect(applyEdit(edit, doc, null)).toBe("- [ ] One #task\n- [x] Two #task\n- [ ] Three #task\n");
  });

  test("replace and insert places the new line immediately after", () => {
    const doc = document("- [ ] One #task\n- [ ] Two #task\n");
    const edit: DocumentEdit = {
      locate: "- [ ] Two #task",
      replacement: "- [x] Two #task ✅ 2026-08-14",
      insert: "- [ ] Two #task 📅 2026-08-21",
    };
    expect(applyEdit(edit, doc, null)).toBe(
      "- [ ] One #task\n- [x] Two #task ✅ 2026-08-14\n- [ ] Two #task 📅 2026-08-21\n",
    );
  });

  test("duplicate lines break ties by nearest preferred index", () => {
    const doc = document("- [ ] Water plants #task\nSome other note text\n- [ ] Water plants #task\n");
    const edit: DocumentEdit = { locate: "- [ ] Water plants #task", replacement: "- [x] Water plants #task" };
    expect(applyEdit(edit, doc, 2)).toBe("- [ ] Water plants #task\nSome other note text\n- [x] Water plants #task\n");
  });

  test("line no longer present throws instead of guessing", () => {
    const doc = document("- [ ] One #task\n");
    const edit: DocumentEdit = { locate: "- [ ] Missing #task", replacement: "- [x] Missing #task" };
    expect(() => applyEdit(edit, doc, null)).toThrow(DocumentEditError);
  });

  test("CRLF line endings are preserved on untouched lines", () => {
    const doc = document("- [ ] One #task\r\n- [ ] Two #task\r\n");
    const edit: DocumentEdit = { locate: "- [ ] Two #task", replacement: "- [x] Two #task" };
    expect(applyEdit(edit, doc, null)).toBe("- [ ] One #task\r\n- [x] Two #task\r\n");
  });

  test("insert after an unterminated last line keeps the file without a trailing newline", () => {
    const doc = document("- [ ] Weekly #task 🔁 every week");
    const edit: DocumentEdit = {
      locate: "- [ ] Weekly #task 🔁 every week",
      replacement: "- [x] Weekly #task 🔁 every week ✅ 2026-08-14",
      insert: "- [ ] Weekly #task 🔁 every week 📅 2026-08-21",
    };
    const result = applyEdit(edit, doc, null);
    expect(result).toBe("- [x] Weekly #task 🔁 every week ✅ 2026-08-14\n- [ ] Weekly #task 🔁 every week 📅 2026-08-21");
    expect(result.endsWith("\n")).toBe(false);
  });

  test("undoing that insert restores the original unterminated file exactly", () => {
    const original = "- [ ] Weekly #task 🔁 every week";
    const doc = document(original);
    const forward: DocumentEdit = {
      locate: "- [ ] Weekly #task 🔁 every week",
      replacement: "- [x] Weekly #task 🔁 every week ✅ 2026-08-14",
      insert: "- [ ] Weekly #task 🔁 every week 📅 2026-08-21",
    };
    const afterComplete = applyEdit(forward, doc, null);
    const undone = applyEdit(inverseEdit(forward), document(afterComplete), null);
    expect(undone).toBe(original);
  });

  test("inverseEdit is involutive", () => {
    const edit: DocumentEdit = { locate: "a", replacement: "b", insert: "c" };
    expect(inverseEdit(inverseEdit(edit))).toEqual(edit);
    const bareEdit: DocumentEdit = { locate: "x", replacement: "y" };
    expect(inverseEdit(inverseEdit(bareEdit))).toEqual(bareEdit);
  });
});

describe("appendEdit", () => {
  test("anchors on the document's last line even when duplicated", () => {
    const doc = document("- [ ] One #task\n\n- [ ] Two #task\n\n");
    const appended = appendEdit("- [ ] Three #task", doc);
    expect(appended?.preferringLineIndex).toBe(3);
    const result = applyEdit(appended!.edit, doc, appended!.preferringLineIndex);
    expect(result).toBe("- [ ] One #task\n\n- [ ] Two #task\n\n- [ ] Three #task\n");
  });

  test("on an unterminated last line, keeps it unterminated on the new line", () => {
    const doc = document("- [ ] One #task");
    const appended = appendEdit("- [ ] Two #task", doc)!;
    const result = applyEdit(appended.edit, doc, appended.preferringLineIndex);
    expect(result).toBe("- [ ] One #task\n- [ ] Two #task");
    expect(result.endsWith("\n")).toBe(false);
  });

  test("returns null for an empty document", () => {
    expect(appendEdit("- [ ] One #task", document(""))).toBeNull();
  });
});

describe("deleteEdit", () => {
  test("deleting a middle line anchors on the preceding line", () => {
    const doc = document("- [ ] One #task\n- [ ] Two #task\n- [ ] Three #task\n");
    const outcome = deleteEdit("- [ ] Two #task", 1, doc);
    if (outcome.kind !== "edit") throw new Error("expected edit");
    expect(outcome.preferringLineIndex).toBe(0);
    expect(applyEdit(outcome.edit, doc, outcome.preferringLineIndex)).toBe("- [ ] One #task\n- [ ] Three #task\n");
  });

  test("deleting the last line anchors on the preceding line and keeps it unterminated", () => {
    const doc = document("- [ ] One #task\n- [ ] Two #task");
    const outcome = deleteEdit("- [ ] Two #task", 1, doc);
    if (outcome.kind !== "edit") throw new Error("expected edit");
    const result = applyEdit(outcome.edit, doc, outcome.preferringLineIndex);
    expect(result).toBe("- [ ] One #task");
    expect(result.endsWith("\n")).toBe(false);
  });

  test("deleting the first line of a multi-line file anchors on the following line", () => {
    const doc = document("- [ ] One #task\n- [ ] Two #task\n- [ ] Three #task\n");
    const outcome = deleteEdit("- [ ] One #task", 0, doc);
    if (outcome.kind !== "edit") throw new Error("expected edit");
    expect(outcome.preferringLineIndex).toBe(0);
    expect(applyEdit(outcome.edit, doc, outcome.preferringLineIndex)).toBe("- [ ] Two #task\n- [ ] Three #task\n");
  });

  test("deleting the first line undoes back to the original arrangement", () => {
    const original = "- [ ] One #task\n- [ ] Two #task\n- [ ] Three #task\n";
    const doc = document(original);
    const outcome = deleteEdit("- [ ] One #task", 0, doc);
    if (outcome.kind !== "edit") throw new Error("expected edit");
    const afterDelete = applyEdit(outcome.edit, doc, outcome.preferringLineIndex);
    const undone = applyEdit(inverseEdit(outcome.edit), document(afterDelete), outcome.preferringLineIndex);
    expect(undone).toBe(original);
  });

  test("deleting the only line in a file returns wholeFileNowEmpty", () => {
    const doc = document("- [ ] Only #task\n");
    expect(deleteEdit("- [ ] Only #task", 0, doc)).toEqual({ kind: "wholeFileNowEmpty" });
  });

  test("deleting a missing line returns notFound", () => {
    const doc = document("- [ ] One #task\n");
    expect(deleteEdit("- [ ] Missing #task", null, doc)).toEqual({ kind: "notFound" });
  });

  test("deleting a duplicate line breaks ties by nearest preferred index", () => {
    const doc = document("- [ ] Water plants #task\nSome other note text\n- [ ] Water plants #task\n");
    const outcome = deleteEdit("- [ ] Water plants #task", 2, doc);
    if (outcome.kind !== "edit") throw new Error("expected edit");
    expect(applyEdit(outcome.edit, doc, outcome.preferringLineIndex)).toBe(
      "- [ ] Water plants #task\nSome other note text\n",
    );
  });
});
