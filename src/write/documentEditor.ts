import type { DocumentLine, LineEnding } from "../parser/DocumentParser.js";

/**
 * A single line-level change to a document: replace one line, optionally insert a line
 * right after it, optionally delete the line right after it. This is the pure,
 * Obsidian-API-free half of §6.4's write path — turning a mutation into new file
 * content is `applyEdit`'s job; coordinating the actual disk write belongs to
 * `vaultWriter.ts`.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Write/DocumentEditor.swift`, with one
 * small deliberate deviation: every function here takes a bare `LineDocument` (just
 * `lines`) rather than a full `ParsedDocument` — this logic never reads `tasks`/
 * `frontmatterTags`/`filePath`, and not requiring them keeps `vaultWriter.ts` from
 * needing a full `parseDocument` call (task-parsing every line) just to edit one, and
 * keeps this file's own tests free of stub data for fields they never touch.
 */

/** The one piece of `ParsedDocument` this module actually needs. */
export interface LineDocument {
  readonly lines: readonly DocumentLine[];
}

export interface DocumentEdit {
  /** Exact text of the line to find — the content match §6.4 requires instead of
   * addressing by line number. */
  readonly locate: string;
  readonly replacement: string;
  /** A line to insert immediately after the (replaced) target. */
  readonly insert?: string;
  /** The following line to remove, if it matches — used by `inverseEdit` to undo an
   * `insert`. */
  readonly deleteFollowing?: string;
}

/** Swaps locate/replacement and insert/deleteFollowing, so
 * `inverseEdit(inverseEdit(edit))` is equivalent to `edit`. This is what makes undo
 * (`applyEdit(inverseEdit(edit), ...)`) and redo fall out of one definition instead of
 * two separate code paths. */
export function inverseEdit(edit: DocumentEdit): DocumentEdit {
  return {
    locate: edit.replacement,
    replacement: edit.locate,
    insert: edit.deleteFollowing,
    deleteFollowing: edit.insert,
  };
}

/** No line in the document matches `edit.locate` any more — the caller must re-read,
 * re-parse, and either abort with a user-visible message or retry against the fresh
 * content, per §6.4. Nothing is guessed. */
export class DocumentEditError extends Error {
  readonly code = "lineNoLongerPresent" as const;

  constructor() {
    super("lineNoLongerPresent");
    this.name = "DocumentEditError";
  }
}

/** What `appendEdit` needs the caller to carry through to `applyEdit`: the constructed
 * edit itself, plus the exact index of the anchor line it locates — required because a
 * capture target file commonly ends with a blank or otherwise duplicated line, and
 * without `preferringLineIndex` the content-match tie-break in `applyEdit` would pick
 * whichever duplicate comes *first* in the file rather than the true last line. */
export interface AppendResult {
  readonly edit: DocumentEdit;
  readonly preferringLineIndex: number;
}

/** Builds the `DocumentEdit` that appends `newLine` as a new last line of `document`, by
 * anchoring an insert-after onto the document's current last line — reusing
 * `applyEdit`'s existing insert machinery (including its unterminated-last-line
 * handling) rather than introducing a second way to add a line to a file. Returns `null`
 * when `document` has no lines at all (a brand-new or empty target file): there is
 * nothing to anchor an insert-after to yet, so the caller must write the file's initial
 * content directly instead — a case this type deliberately doesn't model, since "the
 * file didn't exist before" has no `DocumentEdit` shape (nothing for its inverse to undo
 * back to). */
export function appendEdit(newLine: string, document: LineDocument): AppendResult | null {
  const lastLine = document.lines[document.lines.length - 1];
  if (lastLine === undefined) return null;
  return {
    edit: { locate: lastLine.text, replacement: lastLine.text, insert: newLine },
    preferringLineIndex: document.lines.length - 1,
  };
}

/** Outcome of `deleteEdit` — see that function's doc comment for what each case means
 * and why `wholeFileNowEmpty` exists as a distinct, non-`DocumentEdit`-representable
 * case. */
export type DeleteResult =
  /** `targetLine` isn't present in `document` any more — caller should treat this like
   * `DocumentEditError` (the file changed since it was loaded). */
  | { readonly kind: "notFound" }
  /** `targetLine` is the file's *only* line. Deleting it can't be expressed as a
   * `DocumentEdit` — there's no neighbouring line to anchor to in either direction, and
   * no way to represent "zero lines" via locate+replace. The caller must overwrite the
   * file's content directly instead; there's no undo shape for this case. */
  | { readonly kind: "wholeFileNowEmpty" }
  | { readonly kind: "edit"; readonly edit: DocumentEdit; readonly preferringLineIndex: number };

function findTargetIndex(document: LineDocument, targetText: string, preferringLineIndex: number | null | undefined): number | null {
  const candidates: number[] = [];
  for (let i = 0; i < document.lines.length; i++) {
    if (document.lines[i]!.text === targetText) candidates.push(i);
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;
  if (preferringLineIndex === null || preferringLineIndex === undefined) return candidates[0]!;
  let best = candidates[0]!;
  let bestDistance = Math.abs(best - preferringLineIndex);
  for (const candidate of candidates.slice(1)) {
    const distance = Math.abs(candidate - preferringLineIndex);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Builds the `DocumentEdit` that removes `targetLine` from `document` entirely —
 * §6.4's delete-a-task path. `DocumentEdit` has no "replace with nothing" shape (that
 * would break `inverseEdit`'s symmetry: there'd be nothing left to re-insert *at*), so
 * this reuses the existing `insert`/`deleteFollowing` pair by anchoring the edit to a
 * *neighbouring* line instead of the target — exactly the trick `appendEdit` already
 * uses (anchor to the last line, insert-after) generalised to remove an existing line
 * anywhere in the file, not just add one at the end. */
export function deleteEdit(targetLine: string, preferringLineIndex: number | null, document: LineDocument): DeleteResult {
  const targetIndex = findTargetIndex(document, targetLine, preferringLineIndex);
  if (targetIndex === null) return { kind: "notFound" };
  if (document.lines.length <= 1) return { kind: "wholeFileNowEmpty" };

  if (targetIndex > 0) {
    // Common case: anchor to the preceding line (locate == replacement, i.e. it's left
    // unchanged), delete the target as that anchor's "following" line. `inverseEdit`
    // swaps insert/deleteFollowing, so undo re-inserts the target right back after the
    // same anchor — exactly its original position.
    const preceding = document.lines[targetIndex - 1]!;
    return {
      kind: "edit",
      edit: { locate: preceding.text, replacement: preceding.text, deleteFollowing: targetLine },
      preferringLineIndex: targetIndex - 1,
    };
  }
  // Target is the first line but not the only one: no line precedes it to anchor to, so
  // pull the *following* line's content up into the target's position, then delete the
  // (now-duplicate) original following line. `inverseEdit` swaps locate/replacement
  // *and* insert/deleteFollowing, which cleanly reverses this back to the original
  // two-line arrangement.
  const following = document.lines[1]!;
  return {
    kind: "edit",
    edit: { locate: targetLine, replacement: following.text, deleteFollowing: following.text },
    preferringLineIndex: 0,
  };
}

function fallbackEnding(lines: readonly DocumentLine[], excludingIndex: number): LineEnding {
  for (let i = 0; i < lines.length; i++) {
    if (i !== excludingIndex && lines[i]!.ending !== "") return lines[i]!.ending;
  }
  return "\n";
}

/** Applies a `DocumentEdit` to an already-parsed document and returns the new full file
 * content. Never rewrites content outside the target line (and, when present, the
 * inserted/deleted neighbour) — everything else round-trips through the same
 * `DocumentLine`/`LineEnding` machinery `reserializeDocument` uses, which is
 * byte-identical by construction. */
export function applyEdit(edit: DocumentEdit, document: LineDocument, preferringLineIndex: number | null): string {
  const lines = document.lines.slice();

  // Content match is the real address; `preferringLineIndex` only breaks ties when more
  // than one line is byte-identical (e.g. the same task line duplicated in one note) —
  // picking either candidate produces an identical result, so this doesn't reintroduce
  // line-number addressing.
  const targetIndex = findTargetIndex(document, edit.locate, preferringLineIndex);
  if (targetIndex === null) throw new DocumentEditError();

  const originalEnding = lines[targetIndex]!.ending;
  const wasLastLine = targetIndex === lines.length - 1;
  lines[targetIndex] = { text: edit.replacement, ending: originalEnding };

  if (edit.insert !== undefined) {
    if (wasLastLine && originalEnding === "") {
      // The target was the file's unterminated last line. After inserting, it no longer
      // is — give it a real ending (matching the file's own convention where possible)
      // and hand "" to the newly-inserted line, so "no trailing newline" survives the
      // insert.
      const fallback = fallbackEnding(lines, targetIndex);
      lines[targetIndex] = { text: edit.replacement, ending: fallback };
      lines.splice(targetIndex + 1, 0, { text: edit.insert, ending: "" });
    } else {
      lines.splice(targetIndex + 1, 0, { text: edit.insert, ending: originalEnding });
    }
  }

  if (edit.deleteFollowing !== undefined) {
    const followingIndex = targetIndex + 1;
    if (followingIndex < lines.length && lines[followingIndex]!.text === edit.deleteFollowing) {
      const deletedWasLastLine = followingIndex === lines.length - 1;
      if (deletedWasLastLine) {
        // Symmetric with the insert case above: removing what was the file's last line
        // hands its ending back to the line that becomes last again.
        lines[targetIndex] = { text: lines[targetIndex]!.text, ending: lines[followingIndex]!.ending };
      }
      lines.splice(followingIndex, 1);
    }
  }

  return lines.map((line) => line.text + line.ending).join("");
}
