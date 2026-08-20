/**
 * An inline `#tag`, including nested (`#project/subproject`) and emoji tags. Stored with
 * its leading `#` so display and re-emission never have to guess whether to add one back.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Model/TaskTag.swift`.
 */
export interface TaskTag {
  readonly raw: string;
}

/** Mirrors the Swift original's `precondition` — thrown, not silently coerced, since a
 * `TaskTag` without its leading `#` is a caller bug, not user input to tolerate. */
export function createTaskTag(raw: string): TaskTag {
  if (!raw.startsWith("#")) {
    throw new Error("TaskTag.raw must include the leading #");
  }
  return { raw };
}

/** Case-insensitive equality/hashing key, used for dedupe against inherited frontmatter
 * tags. Same caveat as any cross-language case-folding: JS's `toLowerCase()` and Swift's
 * `lowercased()` agree for the vast majority of real tag text, but are not guaranteed
 * identical on every Unicode edge case (e.g. Turkish dotless I) — not chased further,
 * same category of accepted divergence as `TaskTag`'s own String-vs-Character grapheme
 * question doesn't even arise here since tags don't do range-based slicing. */
export function taskTagNormalizedKey(tag: TaskTag): string {
  return tag.raw.toLowerCase();
}
