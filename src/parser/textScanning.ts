/**
 * Character classification and codepoint-width helpers shared by `LineScanner` and
 * `TaskLineParser`. See `src/model/FieldSpan.ts`'s doc comment for the full UTF-16-vs-
 * grapheme-cluster hazard this file is the practical response to.
 *
 * **Design note, not an oversight**: almost every loop in this parser advances one
 * UTF-16 *code unit* at a time (`i += 1`), not one Unicode *code point* at a time —
 * deliberately, after tracing through the algorithm's actual shape. Every place this
 * parser inspects a character, it either (a) classifies it against a predicate
 * (whitespace / tag-char / letter / digit) or (b) compares it for exact equality against
 * a known single-code-unit ASCII character (` `, `#`, `` ` ``, `[`, `]`, `:`, `^`, `-`,
 * `,`). A lone surrogate half (the result of code-unit-stepping into the middle of a
 * supplementary-plane character, e.g. an emoji) can never satisfy either kind of check:
 * it is never whitespace, never ASCII, never a Unicode letter or decimal digit under the
 * classifiers below. So walking through a 2-code-unit character as two separate "false/
 * continue" steps lands at exactly the same final boundary as treating it as one step
 * would — no classification loop can be tricked into stopping early, extending too far,
 * or mis-locating a boundary. Marker recognition itself uses whole-substring prefix
 * matching (`String.prototype.startsWith`), which is correct regardless of how the
 * scanner arrived at its start position.
 *
 * The one place this reasoning does *not* apply — extracting a single *meaningful*
 * character as data, not just scanning past it — is the task's own status symbol
 * (`[x]`'s `x`), which could in principle be a supplementary-plane emoji if someone
 * configures a custom status that way. `codePointWidth` exists specifically for that one
 * call site, in `TaskLineParser.ts`.
 *
 * This is exactly the plan's own explicitly-flagged Wave 1 risk, resolved by tracing the
 * algorithm rather than assumed — and the conformance corpus's emoji/tag/preservation
 * fixtures are the empirical check that this tracing was actually correct, not merely
 * plausible-sounding.
 */

export function isWhitespaceChar(ch: string): boolean {
  return /\s/u.test(ch);
}

/** Unicode decimal digits (`\p{Nd}`) — broader than ASCII `0-9`, matching Swift's
 * `Character.isNumber` closely enough for list-marker and block-id scanning (Swift's own
 * `isNumber` is technically broader still, covering non-decimal numeric characters too,
 * but decimal digits are what real markdown ordered lists and block-ids actually use). */
export function isNumberChar(ch: string): boolean {
  return /\p{Nd}/u.test(ch);
}

export function isLetterChar(ch: string): boolean {
  return /\p{L}/u.test(ch);
}

const TAG_EXCLUDED_PUNCTUATION = new Set([
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "<",
  ">",
  '"',
  "'",
  "`",
  ",",
  ".",
  "!",
  "?",
  ";",
  ":",
  "*",
  "_",
  "~",
  "^",
  "#",
  "|",
  "\\",
]);

/** 1:1 port of `LineScanner.swift`'s private `isTagChar` — everything is a valid tag
 * character except whitespace and this fixed punctuation set. */
export function isTagChar(ch: string): boolean {
  if (isWhitespaceChar(ch)) return false;
  return !TAG_EXCLUDED_PUNCTUATION.has(ch);
}

export function isAsciiDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/** The number of UTF-16 code units the codepoint starting at `index` occupies — 2 for a
 * supplementary-plane character (surrogate pair), 1 otherwise. Use this only where a
 * *specific* character is being extracted as data (see this file's own doc comment). */
export function codePointWidth(text: string, index: number): number {
  const code = text.codePointAt(index);
  return code !== undefined && code > 0xffff ? 2 : 1;
}
