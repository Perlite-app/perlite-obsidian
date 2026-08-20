/**
 * The kind of field a `FieldSpan` covers. `tag` and `blockedBy` can each occur more than
 * once per line, so `ParsedTask` stores spans as an array rather than a dictionary.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Parser/FieldSpan.swift` (kept in `model/`
 * here per the plugin plan's own chunk-1 grouping, even though the Swift original lives
 * under `Parser/` — it's a data shape, not scanning logic).
 */
export type TaskFieldKind =
  | "due"
  | "scheduled"
  | "start"
  | "created"
  | "done"
  | "cancelled"
  | "reminder"
  | "priority"
  | "recurrence"
  | "onCompletion"
  | "id"
  | "blockedBy"
  | "globalFilterTag"
  | "tag"
  | "wikiLink"
  | "blockID";

/**
 * A half-open `[start, end)` range over a line's **UTF-16 code units** — deliberately
 * plain numeric offsets, not an attempt to emulate Swift's grapheme-cluster-based
 * `String.Index`. This is the plugin plan's own explicitly flagged highest-risk porting
 * decision, made here on purpose rather than by oversight:
 *
 * - Swift's `String.Index` walks extended grapheme clusters — `📅` is one grapheme
 *   cluster but a UTF-16 *surrogate pair* (two code units). JavaScript string indexing
 *   (`.slice`, `.length`, regex match indices — everything) is UTF-16-code-unit-based
 *   throughout, with no grapheme-aware alternative in the standard string API. Obsidian's
 *   own APIs work in UTF-16 code units too, so fighting that would mean fighting the
 *   host platform for no benefit.
 * - The corpus itself is immune to this question — every fixture's `expected` values are
 *   extracted *strings*, never span offsets — but `LineScanner`/`TaskSerializer` (Wave 1
 *   chunks 2-3) are not: a naive port that reused Swift's span offsets as JS string
 *   indices would silently mis-slice on emoji-bearing or combining-character input.
 * - Per the plan: run every conformance fixture touching emoji/unicode
 *   (`tags/`, `links/`, `dates/`'s emoji-marker cases, everything under `preservation/`)
 *   as the first real correctness gate the moment `LineScanner` can parse a single
 *   emoji-bearing line — do not assume this is fine by symmetry with the Swift original.
 */
export interface StringRange {
  readonly start: number;
  readonly end: number;
}

export interface FieldSpan {
  readonly kind: TaskFieldKind;
  readonly fullRange: StringRange;
  readonly valueRange: StringRange;
}
