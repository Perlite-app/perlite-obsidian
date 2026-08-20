/**
 * Errors from parsing a single line. Distinct from a future mutation error (Wave 1 chunk
 * 3), which will cover failures applying an edit to an already-parsed task.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Support/ParserErrors.swift`'s
 * `ParseError`, as a real thrown `Error` subclass — the idiomatic JS/TS mechanism,
 * unlike `model/`'s plain-data style, since this is genuinely control flow (throw/catch),
 * not a value callers hold onto.
 */
export type ParseErrorCode = "notAChecklistItem" | "excludedByGlobalFilter";

export class ParseError extends Error {
  readonly code: ParseErrorCode;

  constructor(code: ParseErrorCode) {
    super(code);
    this.name = "ParseError";
    this.code = code;
  }
}
