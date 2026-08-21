import { calendarDateToISOString } from "../model/CalendarDate.js";
import { dateValueCalendarDate } from "../model/DateValue.js";
import type { ParsedTask } from "../model/ParsedTask.js";
import type { Priority } from "../model/Priority.js";
import type { TaskStatusKind } from "../model/TaskStatus.js";
import type { PerliteIconName } from "./icons.js";

/**
 * The *pure* half of the chip translation layer: parsed fields → what should render,
 * with no DOM and no Obsidian API surface at all — `import type` only from `icons.ts`
 * below, which TypeScript erases entirely, so this file never resolves the real
 * `obsidian` package and is independently unit-testable the same way `LineScanner`'s own
 * logic is. `renderTaskLine.ts` is the thin DOM-building shell that consumes this
 * file's output; keeping them in separate files (not just separate functions in one
 * file) is what actually makes this testable — a pure function co-located in a module
 * that also does a real `import { setIcon } from "obsidian"` still fails to resolve in
 * a plain Vitest run, since ESM module resolution happens per-file, not per-export.
 *
 * 1:1 port of `Perlite/TaskRow.swift` + `Perlite/TaggedText.swift`'s content-computation
 * logic — see `renderTaskLine.ts`'s own doc comment for what's deliberately not ported
 * yet (the recurrence-completion visual cue).
 */

// --- Source context ----------------------------------------------------------------------

/** Obsidian vault paths are always forward-slash-delimited internally regardless of OS —
 * a simplified stand-in for Foundation's `NSString.lastPathComponent` (which also
 * handles trailing slashes and `.`/`..` components), sufficient for a real vault-
 * relative task location, which is never a directory path or has a trailing slash. */
function lastPathComponent(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

/** The note title and nearest parent heading — "Note › Heading", or just the note title
 * when the task has no preceding heading or the heading text is empty. Mirrors
 * `TaskRow.sourceContext` exactly, **including** its `.md`-stripping quirk: every
 * occurrence of literal `".md"` is removed from the filename, not just a trailing
 * extension — a faithful port of the Swift original's `replacingOccurrences(of: ".md",
 * with: "")`, not a place to silently "fix" a pre-existing native-side edge case while
 * porting. */
export function computeSourceContext(task: ParsedTask): string | null {
  if (task.location === null) return null;
  const noteTitle = lastPathComponent(task.location.filePath).replaceAll(".md", "");
  const heading = task.parentHeading;
  if (heading === null || heading.length === 0) return noteTitle;
  return `${noteTitle} › ${heading}`;
}

// --- Description tokenisation (inline #tag chips) -----------------------------------------

export type DescriptionToken = { readonly kind: "word"; readonly text: string } | { readonly kind: "tag"; readonly text: string };

/** Same shape class `LineScanner`'s own tag-character exclusion set uses, approximated
 * here exactly like `TaggedText.swift` approximates it (that logic isn't exposed
 * outside the parser) — verified against representative inputs (nested tags, tags
 * beside punctuation, a `#`-shaped token inside inline code) before relying on it. */
const TAG_SHAPE_REGEX = /#[^\s()[\]{}<>"'`,.!?;:*_~^#|\\]+/gu;

function splitWords(segment: string): DescriptionToken[] {
  return segment
    .split(" ")
    .filter((word) => word.length > 0)
    .map((text) => ({ kind: "word" as const, text }));
}

/** Tokenises a task's description into words and recognised `#tag` chips — mirrors
 * `TaggedText.tokens` exactly: a tag-*shaped* regex match only becomes a `.tag` token
 * when it exactly matches an entry in `task.tags` (the parser's own real recognition),
 * which is what keeps a nested tag (`#project/sub`) rendering as one whole chip instead
 * of partially matching a shorter `#project`, and what keeps a `#`-shaped token the
 * parser didn't recognise (e.g. one sitting inside inline code) from becoming a chip
 * here either — without reimplementing `LineScanner`'s atomic-span-avoidance rules. */
export function tokenizeDescription(task: ParsedTask): DescriptionToken[] {
  const description = task.description;
  if (task.tags.length === 0) {
    return splitWords(description);
  }
  const recognisedTags = new Set(task.tags.map((tag) => tag.raw));

  const result: DescriptionToken[] = [];
  let cursor = 0;
  const regex = new RegExp(TAG_SHAPE_REGEX);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(description)) !== null) {
    const matchText = match[0];
    result.push(...splitWords(description.slice(cursor, match.index)));
    result.push(...(recognisedTags.has(matchText) ? [{ kind: "tag" as const, text: matchText }] : splitWords(matchText)));
    cursor = match.index + matchText.length;
  }
  result.push(...splitWords(description.slice(cursor)));
  return result;
}

// --- Field chips -----------------------------------------------------------------------

export type ChipSpec =
  | { readonly kind: "due"; readonly icon: PerliteIconName; readonly text: string }
  | { readonly kind: "priority"; readonly icon: PerliteIconName; readonly text: string; readonly priority: Priority }
  | { readonly kind: "recurrence"; readonly icon: PerliteIconName }
  | { readonly kind: "subtasks"; readonly icon: PerliteIconName; readonly text: string };

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

/** The due/priority/recurrence/subtask-progress chip row — mirrors `TaskRow.swift`'s
 * `FlowLayout` chip contents exactly, in the same order. `subtaskProgress` is supplied
 * by the caller (a future port of `TaskRelationships`, which needs the whole vault's
 * task list) — this function stays a pure function of one task plus that one optional
 * value, same discipline `TaskRow` itself follows. */
export function computeChipSpecs(task: ParsedTask, subtaskProgress?: { done: number; total: number }): ChipSpec[] {
  const specs: ChipSpec[] = [];

  const due = dateValueCalendarDate(task.due);
  if (due !== null) {
    specs.push({ kind: "due", icon: "calendar", text: calendarDateToISOString(due) });
  }
  if (task.priority !== "normal") {
    specs.push({ kind: "priority", icon: "flag", text: capitalize(task.priority), priority: task.priority });
  }
  if (task.recurrenceRule !== null) {
    specs.push({ kind: "recurrence", icon: "repeat" });
  }
  if (subtaskProgress !== undefined) {
    specs.push({ kind: "subtasks", icon: "circle-check", text: `${subtaskProgress.done}/${subtaskProgress.total}` });
  }
  return specs;
}

// --- Status icon -------------------------------------------------------------------------

export const STATUS_ICON: Readonly<Record<TaskStatusKind, PerliteIconName>> = {
  todo: "circle",
  done: "circle-check",
  cancelled: "circle-x",
  custom: "circle-question-mark",
};

/** Only `todo` is clickable here. The native `TaskRow.statusControl` also makes `done`
 * interactive (tap to uncomplete), but that requires an `uncomplete()` primitive — clear
 * the `done` date and, for a recurring task, find and remove the already-generated next
 * instance — which hasn't been ported to this plugin yet (see `KanbanBoard.ts`'s own
 * "Reopening a done task isn't supported yet" notice, the same limitation stated there).
 * Marking `done` interactive without that primitive behind it is actively harmful, not
 * just an inert affordance: the only thing wired to `onStatusClick` is
 * `completeTaskAndWrite`, which re-runs `RecurrenceEngine.complete` on an
 * already-completed task — silently stomping its `done` date to today for a plain task,
 * and inserting a duplicate next-instance line on every click for a recurring one (this
 * plugin's `buildNextInstance` already guards against a *corrupted* duplicate — it always
 * clears `.done` on the new line — but nothing stops the duplicate insertion itself).
 * Revisit once `uncomplete()` is ported; until then this must stay `todo`-only, not a
 * mirror of the native switch. */
export function isStatusInteractive(kind: TaskStatusKind): boolean {
  return kind === "todo";
}
