/**
 * An Obsidian internal link, `[[note]]` or `[[note|alias]]`. Preserved verbatim — Perlite
 * never resolves or rewrites the target.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Model/WikiLink.swift`. No invariant to
 * validate (unlike `TaskTag`), so — deliberately, no factory function here, plain object
 * literals are the whole API.
 */
export interface WikiLink {
  readonly target: string;
  readonly alias: string | null;
  /** The exact source text, including the `[[` `]]` delimiters. */
  readonly raw: string;
}
