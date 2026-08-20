import type { FieldSpan, StringRange, TaskFieldKind } from "../model/FieldSpan.js";
import { parseDateValue } from "../model/DateValue.js";
import type { ParsedTask } from "../model/ParsedTask.js";
import { priorityFromMarker } from "../model/Priority.js";
import { parseReminderValue } from "../model/ReminderValue.js";
import { createTaskStatus } from "../model/TaskStatus.js";
import type { TaskTag } from "../model/TaskTag.js";
import type { TaskLocation } from "../model/TaskLocation.js";
import { DEFAULT_PARSER_CONFIGURATION, type ParserConfiguration } from "./ParserConfiguration.js";
import { ParseError } from "./ParserErrors.js";
import { scanLine } from "./LineScanner.js";
import { codePointWidth, isLetterChar, isNumberChar, isWhitespaceChar } from "./textScanning.js";

/**
 * Parses a single line into a `ParsedTask`, or throws `ParseError` when the line is not
 * a task at all. Never called on lines inside code fences or YAML frontmatter — that
 * filtering is `DocumentParser`'s job (Wave 1 chunk 4).
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Parser/TaskLineParser.swift`.
 */

/** Recognises `- `, `* `, `+ `, and ordered `1. ` (any digit run) list markers. */
function matchListMarker(raw: string, start: number, end: number): StringRange | null {
  if (start >= end) return null;
  const c = raw[start]!;
  if (c === "-" || c === "*" || c === "+") {
    const next = start + 1;
    if (next < end && raw[next] === " ") {
      return { start, end: next + 1 };
    }
    return null;
  }
  if (isNumberChar(c)) {
    let i = start;
    while (i < end && isNumberChar(raw[i]!)) {
      i += 1;
    }
    if (!(i < end && raw[i] === ".")) return null;
    const afterDot = i + 1;
    if (!(afterDot < end && raw[afterDot] === " ")) return null;
    return { start, end: afterDot + 1 };
  }
  return null;
}

/**
 * Detects a trailing Obsidian block reference (`^block-id`), which must be the last
 * token on the line and is unrelated to the Tasks plugin's own `🆔` field. Returns the
 * range covering the reference and its separating space, or `null` if none is present.
 *
 * Every backward walk is floored at `bodyStart`, never index 0: without that, a body
 * consisting of *only* a block reference (`"- [ ] ^block-id"`) would let the
 * trailing-space walk consume the mandatory space after `] ` too — the exact
 * range-inversion bug the Swift original's own fuzz suite caught on its first run.
 */
function matchTrailingBlockID(raw: string, bodyStart: number, bodyEnd: number): StringRange | null {
  if (bodyEnd <= bodyStart) return null;
  let i = bodyEnd - 1;
  let end = bodyEnd;
  while (i > bodyStart && isWhitespaceChar(raw[i]!)) {
    i -= 1;
    end -= 1;
  }
  let idStart = end;
  while (idStart > bodyStart) {
    const prior = idStart - 1;
    const c = raw[prior]!;
    if (isLetterChar(c) || isNumberChar(c) || c === "-") {
      idStart = prior;
    } else {
      break;
    }
  }
  if (!(idStart > bodyStart && idStart < end)) return null;
  const markerIndex = idStart - 1;
  if (raw[markerIndex] !== "^") return null;
  let spanStart = markerIndex;
  while (spanStart > bodyStart && raw[spanStart - 1] === " ") {
    spanStart -= 1;
  }
  return { start: spanStart, end: bodyEnd };
}

/**
 * Concatenates the parts of `range` not covered by any span matching `predicate`,
 * preserving all original spacing outside the removed spans. Shared by description
 * construction here and by the serializer's removal logic (Wave 1 chunk 3).
 */
export function joinedGaps(
  raw: string,
  range: StringRange,
  spans: readonly FieldSpan[],
  predicate: (span: FieldSpan) => boolean,
): string {
  const removals = spans.filter(predicate).slice().sort((a, b) => a.fullRange.start - b.fullRange.start);
  let result = "";
  let cursor = range.start;
  for (const span of removals) {
    if (span.fullRange.start < cursor) continue;
    if (span.fullRange.start > cursor) {
      result += raw.slice(cursor, span.fullRange.start);
    }
    cursor = span.fullRange.end;
  }
  if (cursor < range.end) {
    result += raw.slice(cursor, range.end);
  }
  return result;
}

const REMOVABLE_KINDS = new Set<TaskFieldKind>([
  "due",
  "scheduled",
  "start",
  "created",
  "done",
  "cancelled",
  "reminder",
  "priority",
  "recurrence",
  "onCompletion",
  "id",
  "blockedBy",
  "globalFilterTag",
]);

export interface ParseLineOptions {
  location?: TaskLocation | null;
  configuration?: ParserConfiguration;
  inheritedTags?: readonly TaskTag[];
  parentHeading?: string | null;
}

export function parseLine(raw: string, options: ParseLineOptions = {}): ParsedTask {
  const location = options.location ?? null;
  const configuration = options.configuration ?? DEFAULT_PARSER_CONFIGURATION;
  const inheritedTags = options.inheritedTags ?? [];
  const parentHeading = options.parentHeading ?? null;

  const end = raw.length;
  let i = 0;

  let indentEnd = i;
  while (indentEnd < end && (raw[indentEnd] === " " || raw[indentEnd] === "\t")) {
    indentEnd += 1;
  }
  const indent = raw.slice(i, indentEnd);
  i = indentEnd;

  const markerRange = matchListMarker(raw, i, end);
  if (markerRange === null) throw new ParseError("notAChecklistItem");
  const listMarker = raw.slice(markerRange.start, markerRange.end);
  i = markerRange.end;

  if (!(i < end && raw[i] === "[")) throw new ParseError("notAChecklistItem");
  i += 1;
  if (!(i < end)) throw new ParseError("notAChecklistItem");
  const statusWidth = codePointWidth(raw, i);
  const statusChar = raw.slice(i, i + statusWidth);
  const statusCharRange: StringRange = { start: i, end: i + statusWidth };
  i += statusWidth;
  if (!(i < end && raw[i] === "]")) throw new ParseError("notAChecklistItem");
  i += 1;

  let bodyStart = i;
  if (bodyStart < end && raw[bodyStart] === " ") {
    bodyStart += 1;
  }

  let bodyEnd = end;
  const blockIDRange = matchTrailingBlockID(raw, bodyStart, bodyEnd);
  if (blockIDRange !== null) {
    bodyEnd = blockIDRange.start;
  }

  const bodyRange: StringRange = { start: bodyStart, end: bodyEnd };
  const scan = scanLine(raw, bodyRange, configuration);

  if (configuration.globalFilter !== null && !scan.globalFilterPresent) {
    throw new ParseError("excludedByGlobalFilter");
  }

  function firstValue(kind: TaskFieldKind): string | null {
    const span = scan.spans.find((s) => s.kind === kind);
    return span === undefined ? null : raw.slice(span.valueRange.start, span.valueRange.end);
  }

  const dueRaw = firstValue("due");
  const scheduledRaw = firstValue("scheduled");
  const startRaw = firstValue("start");
  const createdRaw = firstValue("created");
  const doneRaw = firstValue("done");
  const cancelledRaw = firstValue("cancelled");
  const reminderRaw = firstValue("reminder");
  const priorityMarkerText = firstValue("priority");
  const recurrenceRule = firstValue("recurrence");
  const onCompletion = firstValue("onCompletion");
  const id = firstValue("id");
  const blockedByRaw = firstValue("blockedBy");

  const blockedBy =
    blockedByRaw === null
      ? []
      : blockedByRaw
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part.length > 0);

  const description = joinedGaps(raw, bodyRange, scan.spans, (span) => REMOVABLE_KINDS.has(span.kind)).trim();

  const insertionPoint = bodyEnd;

  return {
    raw,
    location,
    indent,
    listMarker,
    status: createTaskStatus(statusChar),
    description,
    due: dueRaw === null ? null : parseDateValue(dueRaw),
    scheduled: scheduledRaw === null ? null : parseDateValue(scheduledRaw),
    start: startRaw === null ? null : parseDateValue(startRaw),
    created: createdRaw === null ? null : parseDateValue(createdRaw),
    done: doneRaw === null ? null : parseDateValue(doneRaw),
    cancelled: cancelledRaw === null ? null : parseDateValue(cancelledRaw),
    reminder: reminderRaw === null ? null : parseReminderValue(reminderRaw),
    priority: (priorityMarkerText === null ? null : priorityFromMarker(priorityMarkerText)) ?? "normal",
    recurrenceRule,
    onCompletion,
    id,
    blockedBy,
    parentHeading,
    tags: scan.tags,
    inheritedTags,
    links: scan.links,
    indentDepth: indentDepthFor(indent),
    spans: scan.spans,
    statusCharRange,
    bodyStart,
    insertionPoint,
  };
}

/**
 * Approximates Obsidian's list-indentation depth: each level is either one tab or (by
 * convention, matching Obsidian's default) 4 spaces. Good enough for display; real
 * nesting is derived from the document's parent/child line structure in `DocumentParser`
 * (Wave 1 chunk 4), not from this number alone.
 */
function indentDepthFor(indent: string): number {
  let depth = 0;
  let spaceRun = 0;
  for (const c of indent) {
    if (c === "\t") {
      depth += 1;
      spaceRun = 0;
    } else if (c === " ") {
      spaceRun += 1;
      if (spaceRun === 4) {
        depth += 1;
        spaceRun = 0;
      }
    }
  }
  return depth;
}
