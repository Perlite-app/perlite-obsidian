import type { DateValue } from "./DateValue.js";
import type { FieldSpan, StringRange } from "./FieldSpan.js";
import type { Priority } from "./Priority.js";
import type { ReminderValue } from "./ReminderValue.js";
import { type TaskTag, taskTagNormalizedKey } from "./TaskTag.js";
import type { TaskLocation } from "./TaskLocation.js";
import type { TaskStatus } from "./TaskStatus.js";
import type { WikiLink } from "./WikiLink.js";

/**
 * The semantic view of one task line, plus everything the serialiser needs to write it
 * back with only the fields that changed. `raw` is the exact source line (no trailing
 * newline); `spans` locate every field `raw` was recognised to contain. Anything not
 * covered by a span — unknown syntax, unrecognised emoji, malformed constructs the
 * scanner chose not to interpret — is preserved automatically because the serialiser
 * only ever touches spans.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Model/ParsedTask.swift`, field-for-field.
 * `spans`/`statusCharRange`/`bodyStart`/`insertionPoint` are Swift-`internal` there
 * (hidden from the native app target, visible to `TaskSerializer` in the same module) —
 * there is no equivalent cross-package boundary in this single-package repo, so they're
 * exported like every other field here, just documented as parser/serializer-only.
 */
export interface ParsedTask {
  readonly raw: string;
  readonly location: TaskLocation | null;

  readonly indent: string;
  readonly listMarker: string;
  readonly status: TaskStatus;

  /** The body text with recognised field markers (dates, priority, recurrence,
   * on-completion, id, blocked-by, and the global filter tag) removed. Tags and links
   * remain inline, since they are part of the task's readable title, not metadata to
   * hide. */
  readonly description: string;

  readonly due: DateValue | null;
  readonly scheduled: DateValue | null;
  readonly start: DateValue | null;
  readonly created: DateValue | null;
  readonly done: DateValue | null;
  readonly cancelled: DateValue | null;
  /** The `⏰` reminder field — deliberately its own type, not folded into
   * `due`/`scheduled`, since it carries an optional time-of-day no other date field
   * has. */
  readonly reminder: ReminderValue | null;

  readonly priority: Priority;
  /** Raw recurrence rule text (e.g. "every week", "every 3 days when done"). Evaluation
   * into next-instance dates is the recurrence engine's job (Wave 1 chunk 5), not this
   * layer's. */
  readonly recurrenceRule: string | null;
  readonly onCompletion: string | null;
  readonly id: string | null;
  readonly blockedBy: readonly string[];

  /** The nearest ATX heading (`#`…`######`) above this task in its file, or `null` if
   * none precedes it. File-level context a single-line parse can't have, so `null`
   * unless the caller (`DocumentParser`, Wave 1 chunk 4) supplies it — mirrors
   * `inheritedTags` for the same reason. Setext headings (`===`/`---` underlines) are
   * deliberately not recognised, matching the Swift original. */
  readonly parentHeading: string | null;

  readonly tags: readonly TaskTag[];
  /** Tags inherited from the file's YAML frontmatter, when frontmatter tag inheritance
   * is on — empty otherwise, and always empty for a task parsed directly without going
   * through the document parser, since inheritance requires file-level context a single
   * line doesn't have. Display-only: never touched by the serializer, never written
   * back to the file. Use `allTags()` for the merged, deduplicated view; `tags` alone
   * still means "what this line itself declares." */
  readonly inheritedTags: readonly TaskTag[];
  readonly links: readonly WikiLink[];

  readonly indentDepth: number;

  /** Used by the serializer (Wave 1 chunk 3) to locate replace/remove targets. */
  readonly spans: readonly FieldSpan[];
  /** The single character between `[` and `]`, for a future `setStatus` mutation. */
  readonly statusCharRange: StringRange;
  /** Where the body begins, right after `] ` — the start of the description region. */
  readonly bodyStart: number;
  /** Where a newly-inserted field is spliced in: after all existing content, before any
   * trailing `^block-id` reference and trailing whitespace. */
  readonly insertionPoint: number;
}

/**
 * `task.tags` plus any `task.inheritedTags` not already present (case-insensitively)
 * among them, with the task's own inline tags winning on both casing and ordering.
 * Mirrors `ParsedTask.allTags` exactly. This is what filtering, grouping, and tag-usage
 * counting (Wave 2) should read — `tags` alone under-counts a task whenever inheritance
 * is on.
 */
export function allTags(task: ParsedTask): readonly TaskTag[] {
  if (task.inheritedTags.length === 0) return task.tags;
  const seenKeys = new Set(task.tags.map(taskTagNormalizedKey));
  const merged = [...task.tags];
  for (const tag of task.inheritedTags) {
    const key = taskTagNormalizedKey(tag);
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      merged.push(tag);
    }
  }
  return merged;
}
