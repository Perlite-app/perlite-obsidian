import type { FieldSpan, StringRange, TaskFieldKind } from "../model/FieldSpan.js";
import type { Priority } from "../model/Priority.js";
import { createTaskTag, type TaskTag } from "../model/TaskTag.js";
import type { WikiLink } from "../model/WikiLink.js";
import type { ParserConfiguration } from "./ParserConfiguration.js";
import { isTagChar, isWhitespaceChar } from "./textScanning.js";

/**
 * Scans a task line's body (the text after `] `) for recognised fields, tags and links.
 *
 * Atomic spans — inline code, markdown links, wikilinks — are consumed whole before the
 * scanner looks for anything else, so a `#` inside a link is never misread as a tag and
 * an emoji inside code is never misread as a field marker.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Parser/LineScanner.swift`. See
 * `textScanning.ts`'s doc comment for why plain UTF-16 code-unit stepping throughout
 * this file is a deliberate, traced-through-correct choice, not an oversight — this is
 * the plugin plan's own explicitly flagged highest-risk porting decision.
 */
export interface LineScanResult {
  spans: FieldSpan[];
  tags: TaskTag[];
  links: WikiLink[];
  globalFilterPresent: boolean;
}

type MarkerEntry<T> = readonly [marker: string, value: T];

/** Each marker also matches with a trailing variation selector (U+FE0F), which some
 * inputs include — the VS16 variant is listed first (via sorting by descending length)
 * so it is tried before the bare marker at the same position. */
function expand<T>(pairs: ReadonlyArray<MarkerEntry<T>>): MarkerEntry<T>[] {
  const out: MarkerEntry<T>[] = [];
  for (const [marker, value] of pairs) {
    out.push([marker + "\uFE0F", value]);
    out.push([marker, value]);
  }
  out.sort((a, b) => b[0].length - a[0].length);
  return out;
}

const DATE_MARKERS: MarkerEntry<TaskFieldKind>[] = expand([
  ["📅", "due"],
  ["📆", "due"],
  ["🗓", "due"],
  ["⏳", "scheduled"],
  ["⌛", "scheduled"],
  ["🛫", "start"],
  ["➕", "created"],
  ["✅", "done"],
  ["❌", "cancelled"],
  ["⏰", "reminder"],
]);

const TOKEN_MARKERS: MarkerEntry<TaskFieldKind>[] = expand([
  ["🔁", "recurrence"],
  ["🏁", "onCompletion"],
  ["🆔", "id"],
  ["⛔", "blockedBy"],
]);

const PRIORITY_MARKERS: MarkerEntry<Priority>[] = expand([
  ["🔺", "highest"],
  ["⏫", "high"],
  ["🔼", "medium"],
  ["🔽", "low"],
  ["⏬", "lowest"],
]);

function firstMatchingMarker<T>(raw: string, i: number, markers: readonly MarkerEntry<T>[]): MarkerEntry<T> | null {
  for (const entry of markers) {
    if (raw.startsWith(entry[0], i)) return entry;
  }
  return null;
}

export function scanLine(raw: string, bodyRange: StringRange, configuration: ParserConfiguration): LineScanResult {
  const result: LineScanResult = { spans: [], tags: [], links: [], globalFilterPresent: false };
  let i = bodyRange.start;
  const end = bodyRange.end;
  let consumedUpTo = bodyRange.start;

  /** Widens a matched field's core range (marker/value, no separator) into its full
   * range: it claims one adjacent space, preferring the space *before* it (the normal
   * case) but falling back to the space *after* it when the field sits at the very
   * start of the body, where there is nothing before to claim. Without the fallback,
   * removing a leading field would strand the separator that used to follow it,
   * producing a double space. */
  function widen(coreStart: number, coreEnd: number): StringRange {
    if (coreStart > consumedUpTo && coreStart > bodyRange.start) {
      const prior = coreStart - 1;
      if (raw[prior] === " ") {
        return { start: prior, end: coreEnd };
      }
    }
    if (coreStart === bodyRange.start && coreEnd < end && raw[coreEnd] === " ") {
      return { start: coreStart, end: coreEnd + 1 };
    }
    return { start: coreStart, end: coreEnd };
  }

  while (i < end) {
    const c = raw[i];

    if (c === "`") {
      const close = findClosing(raw, "`", i + 1, end);
      i = close !== null ? close + 1 : i + 1;
      consumedUpTo = i;
      continue;
    }

    if (c === "[" && raw.startsWith("[[", i)) {
      const wikiEnd = findClosing2(raw, "]]", i + 2, end);
      if (wikiEnd !== null) {
        const contentStart = i + 2;
        const content = raw.slice(contentStart, wikiEnd);
        const linkEnd = wikiEnd + 2;
        const pipeIndex = content.indexOf("|");
        if (pipeIndex !== -1) {
          const target = content.slice(0, pipeIndex);
          const alias = content.slice(pipeIndex + 1);
          result.links.push({ target, alias, raw: raw.slice(i, linkEnd) });
        } else {
          result.links.push({ target: content, alias: null, raw: raw.slice(i, linkEnd) });
        }
        i = linkEnd;
        consumedUpTo = i;
        continue;
      }
    }

    if (c === "[") {
      const markdownLinkEnd = findMarkdownLinkEnd(raw, i, end);
      if (markdownLinkEnd !== null) {
        i = markdownLinkEnd;
        consumedUpTo = i;
        continue;
      }
    }

    const dateMatch = firstMatchingMarker(raw, i, DATE_MARKERS);
    if (dateMatch !== null) {
      const [marker, kind] = dateMatch;
      const markerEnd = i + marker.length;
      const valueStart = skipSingleSpace(raw, markerEnd, end);
      const valueEnd = kind === "reminder" ? findReminderEnd(raw, valueStart, end) : findTokenEnd(raw, valueStart, end);
      if (hasUsableToken(raw, valueStart, valueEnd)) {
        const fullRange = widen(i, valueEnd);
        result.spans.push({ kind, fullRange, valueRange: { start: valueStart, end: valueEnd } });
        i = fullRange.end;
        consumedUpTo = i;
        continue;
      }
    }

    const tokenMatch = firstMatchingMarker(raw, i, TOKEN_MARKERS);
    if (tokenMatch !== null) {
      const [marker, kind] = tokenMatch;
      const markerEnd = i + marker.length;
      const valueStart = skipSingleSpace(raw, markerEnd, end);
      const valueEnd = kind === "recurrence" ? findRecurrenceEnd(raw, valueStart, end) : findTokenEnd(raw, valueStart, end);
      if (hasUsableToken(raw, valueStart, valueEnd)) {
        const fullRange = widen(i, valueEnd);
        result.spans.push({ kind, fullRange, valueRange: { start: valueStart, end: valueEnd } });
        i = fullRange.end;
        consumedUpTo = i;
        continue;
      }
    }

    const priorityMatch = firstMatchingMarker(raw, i, PRIORITY_MARKERS);
    if (priorityMatch !== null) {
      const [marker] = priorityMatch;
      const markerEnd = i + marker.length;
      const fullRange = widen(i, markerEnd);
      result.spans.push({ kind: "priority", fullRange, valueRange: { start: i, end: markerEnd } });
      i = fullRange.end;
      consumedUpTo = i;
      continue;
    }

    if (c === "#") {
      const tagEnd = findTagEnd(raw, i + 1, end);
      if (tagEnd > i + 1) {
        const text = raw.slice(i, tagEnd);
        const fullRange = widen(i, tagEnd);
        if (configuration.globalFilter !== null && text === configuration.globalFilter) {
          result.globalFilterPresent = true;
          result.spans.push({ kind: "globalFilterTag", fullRange, valueRange: { start: i, end: tagEnd } });
        } else {
          result.tags.push(createTaskTag(text));
          result.spans.push({ kind: "tag", fullRange, valueRange: { start: i, end: tagEnd } });
        }
        i = fullRange.end;
        consumedUpTo = i;
        continue;
      }
    }

    i += 1;
  }

  return result;
}

// --- Character classification ------------------------------------------------------

function findTagEnd(raw: string, start: number, end: number): number {
  let i = start;
  while (i < end && isTagChar(raw[i]!)) {
    i += 1;
  }
  return i;
}

/** A marker's value token is only accepted if it is non-empty and does not itself look
 * like the start of a tag. Without this, a marker with nothing meaningful after it
 * (`📅 #task` with no date) would silently swallow the following tag as its "value" —
 * including the global filter tag, breaking filter detection. When rejected, the marker
 * character is left as ordinary unrecognised text and no span is created for it, so it
 * round-trips as-is rather than corrupting an adjacent field. */
function hasUsableToken(raw: string, valueStart: number, valueEnd: number): boolean {
  return valueStart < valueEnd && raw[valueStart] !== "#";
}

function findTokenEnd(raw: string, start: number, end: number): number {
  let i = start;
  while (i < end && !isWhitespaceChar(raw[i]!)) {
    i += 1;
  }
  return i;
}

/** The reminder field's value token is the date alone, unless it is immediately followed
 * by a single space and an `HH:mm`-shaped token — in which case both are captured as one
 * span so `⏰ 2026-08-19 20:15` doesn't strand the time half in `description` the way a
 * plain `findTokenEnd` (whitespace-delimited) would. Purely shape-gated (two digits, a
 * colon, two digits) — range validation is `parseReminderValue`'s job, not the
 * scanner's. */
function findReminderEnd(raw: string, start: number, end: number): number {
  const dateEnd = findTokenEnd(raw, start, end);
  if (!(dateEnd < end && raw[dateEnd] === " ")) return dateEnd;
  const timeStart = dateEnd + 1;
  const timeEnd = findTokenEnd(raw, timeStart, end);
  if (!isClockTimeShaped(raw, timeStart, timeEnd)) return dateEnd;
  return timeEnd;
}

function isClockTimeShaped(raw: string, start: number, end: number): boolean {
  if (end - start !== 5) return false;
  const token = raw.slice(start, end);
  return (
    isAsciiDigit(token[0]!) &&
    isAsciiDigit(token[1]!) &&
    token[2] === ":" &&
    isAsciiDigit(token[3]!) &&
    isAsciiDigit(token[4]!)
  );
}

function isAsciiDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/** Recurrence text can contain spaces ("every 3 weeks"). Reads until end of body or the
 * start of another recognised marker, whichever comes first, trimming trailing
 * whitespace. */
function findRecurrenceEnd(raw: string, start: number, end: number): number {
  let i = start;
  let lastNonSpace = start;
  while (i < end) {
    const c = raw[i]!;
    if (c === "#") break;
    if (firstMatchingMarker(raw, i, DATE_MARKERS) !== null) break;
    if (firstMatchingMarker(raw, i, TOKEN_MARKERS) !== null) break;
    if (firstMatchingMarker(raw, i, PRIORITY_MARKERS) !== null) break;
    if (!isWhitespaceChar(c)) lastNonSpace = i + 1;
    i += 1;
  }
  return lastNonSpace;
}

function skipSingleSpace(raw: string, start: number, end: number): number {
  if (start < end && raw[start] === " ") return start + 1;
  return start;
}

function findClosing(raw: string, char: string, start: number, end: number): number | null {
  let i = start;
  while (i < end) {
    if (raw[i] === char) return i;
    i += 1;
  }
  return null;
}

function findClosing2(raw: string, marker: string, start: number, end: number): number | null {
  let i = start;
  while (i < end) {
    if (raw.startsWith(marker, i)) return i;
    i += 1;
  }
  return null;
}

/** `[text](url)` — returns the index just past the closing `)`, or `null` if the line
 * does not have that shape starting at `start` (in which case it is not a markdown link
 * and the caller should treat `[` as ordinary text). */
function findMarkdownLinkEnd(raw: string, start: number, end: number): number | null {
  let i = start + 1;
  while (i < end && raw[i] !== "]") {
    i += 1;
  }
  if (!(i < end && raw[i] === "]")) return null;
  const afterBracket = i + 1;
  if (!(afterBracket < end && raw[afterBracket] === "(")) return null;
  let j = afterBracket + 1;
  while (j < end && raw[j] !== ")") {
    j += 1;
  }
  if (!(j < end && raw[j] === ")")) return null;
  return j + 1;
}
