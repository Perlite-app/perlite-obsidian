/**
 * Errors from parsing a single line, and from applying a field mutation to an
 * already-parsed task. 1:1 port of
 * `PerliteCore/Sources/PerliteCore/Support/ParserErrors.swift`'s `ParseError` and
 * `MutationError`, as real thrown `Error` subclasses — the idiomatic JS/TS mechanism,
 * unlike `model/`'s plain-data style, since these are genuinely control flow
 * (throw/catch), not values callers hold onto.
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

/** The value could not be encoded into the line (e.g. a tag missing its `#` prefix), or
 * — via `TaskSerializer`'s internal `reparse` — the mutation produced text that no
 * longer parses as a task at all, which mutations are not expected to ever produce. */
export class MutationError extends Error {
  readonly code = "invalidValue" as const;
  readonly value: string;

  constructor(value: string) {
    super(`invalidValue: ${value}`);
    this.name = "MutationError";
    this.value = value;
  }
}
