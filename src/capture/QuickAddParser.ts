import * as chrono from "chrono-node";
import type { CalendarDate } from "../model/CalendarDate.js";
import type { ClockTime } from "../model/ClockTime.js";
import type { Priority } from "../model/Priority.js";
import { ParseError } from "../parser/ParserErrors.js";
import { DEFAULT_PARSER_CONFIGURATION, type ParserConfiguration } from "../parser/ParserConfiguration.js";
import { parseLine } from "../parser/TaskLineParser.js";
import * as TaskSerializer from "../parser/TaskSerializer.js";
import type { ParsedTask } from "../model/ParsedTask.js";
import { parseRecurrenceRule } from "../recurrence/RecurrenceParser.js";

/**
 * Wave 2 chunk 13's quick-capture command: Tier-1-equivalent deterministic parsing
 * ported from `QuickAddParser.swift`. **Research spike result** (the plan explicitly
 * asked for one before scoping this chunk, since the native app's post-chunk-22 design
 * depends on `NSDataDetector`, which has no direct JS/Obsidian equivalent): `chrono-node`
 * was evaluated against the same representative phrases the native app's own chunk 22
 * commit message lists ("Standup on Wednesday at 20:15", "next monday", "in 3 days",
 * bare weekdays, ISO dates, "at 8pm") and matches or exceeds `NSDataDetector`'s coverage
 * on every one — including giving a *real* per-component certainty flag
 * (`isCertain("hour")`), which is strictly better than `NSDataDetector`'s undocumented
 * "resolves date-only phrases to exactly noon" behaviour the native app had to treat as
 * a sentinel. Chosen over hand-rolling a regex subset for the same reason chunk 22
 * itself abandoned regex: a natural-language date library genuinely dominates a fixed
 * word list, at a bundled-dependency cost this plugin (unlike the Swift app's zero-
 * third-party-dependency rule) has no standing constraint against.
 */

export interface QuickAddReminder {
  readonly date: CalendarDate;
  readonly time: ClockTime | null;
}

/** `time === null` never happens from `parse` itself (see `hasExplicitTime` below); it
 * exists so a UI-constructed reminder can represent a bare date with no specific time. */
export interface QuickAddResult {
  readonly description: string;
  readonly dueDate: CalendarDate | null;
  readonly priority: Priority | null;
  readonly reminder: QuickAddReminder | null;
  /** `scheduled`/`start` are never produced by `parse` — no deterministic phrase in free
   * text maps unambiguously onto "scheduled" vs "due" vs "start"; they exist so a
   * capture UI offering explicit controls has somewhere to put a direct selection.
   * `recurrenceRule` *is* parsed since the design-pass port of the native app's chunk 58
   * (an `every …` phrase `parseRecurrenceRule` accepts). */
  readonly scheduled: CalendarDate | null;
  readonly start: CalendarDate | null;
  readonly recurrenceRule: string | null;
}

export function createQuickAddResult(overrides: Partial<QuickAddResult> & { description: string }): QuickAddResult {
  return {
    dueDate: null,
    priority: null,
    reminder: null,
    scheduled: null,
    start: null,
    recurrenceRule: null,
    ...overrides,
  };
}

// --- Priority shorthand ------------------------------------------------------------------

/** `!highest`/`!lowest`/`!medium`/`!high`/`!low`, case-insensitive — longer names before
 * their own prefixes so the ordered alternation doesn't strand letters. Plus the
 * bang-count shorthand (`!` low, `!!` medium, `!!!` high), only as a standalone word so
 * "Call Sam!" is never read as a priority — the same rule `QuickAddParser.swift` uses. */
const PRIORITY_REGEX = /!(highest|lowest|medium|high|low)\b|(?<!\S)(!{1,3})(?!\S)/i;

const BANG_PRIORITY: Readonly<Record<number, Priority>> = { 1: "low", 2: "medium", 3: "high" };

function firstPriorityMatch(text: string): { readonly priority: Priority; readonly start: number; readonly end: number } | null {
  const match = PRIORITY_REGEX.exec(text);
  if (match === null || match.index === undefined) return null;
  const priority = match[1] !== undefined ? (match[1].toLowerCase() as Priority) : BANG_PRIORITY[match[2]!.length]!;
  return { priority, start: match.index, end: match.index + match[0].length };
}

// --- Recurrence ----------------------------------------------------------------------------

const WEEKDAY_NAMES = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";

/** "every day", "every 2 weeks", "every week on Monday", "every month when done", and the
 * shorthand "every Friday" (written as "every week on Friday", the form the Tasks plugin
 * itself writes). Only taken when `parseRecurrenceRule` accepts the resulting rule. */
const RECURRENCE_REGEX = new RegExp(
  `\\bevery\\s+(?:(\\d+\\s+)?(days?|weeks?|months?|years?)(\\s+on\\s+(?:${WEEKDAY_NAMES})(?:\\s*,\\s*(?:${WEEKDAY_NAMES}))*)?|(${WEEKDAY_NAMES}))(\\s+when\\s+done)?\\b`,
  "gi",
);

function capitalize(word: string): string {
  return word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1).toLowerCase();
}

function firstRecurrenceMatch(text: string): { readonly rule: string; readonly start: number; readonly end: number } | null {
  const regex = new RegExp(RECURRENCE_REGEX);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const whenDone = match[5] !== undefined ? " when done" : "";
    let rule: string;
    if (match[4] !== undefined) {
      rule = `every week on ${capitalize(match[4])}${whenDone}`;
    } else {
      const interval = match[1] !== undefined ? `${match[1].trim()} ` : "";
      const unit = (match[2] ?? "").toLowerCase();
      const days =
        match[3] !== undefined
          ? ` on ${match[3]
              .trim()
              .slice(2)
              .split(",")
              .map((day) => capitalize(day.trim()))
              .join(",")}`
          : "";
      rule = `every ${interval}${unit}${days}${whenDone}`;
    }
    if (parseRecurrenceRule(rule) !== null) {
      return { rule, start: match.index, end: match.index + match[0].length };
    }
  }
  return null;
}

// --- Tags (spans only) ---------------------------------------------------------------------

/** Highlighting only — tags stay in the description. A `#` not preceded by a word
 * character, followed by at least one non-digit tag character. */
const TAG_REGEX = /(?<![\p{L}\p{N}_#])#[\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*/gu;

// --- Due date/time recognition -----------------------------------------------------------

/** A word immediately preceding chrono's match that's absorbed into the removed range
 * along with it — chrono recognises "Wednesday" or "8pm" on their own but never grabs a
 * leading connector ("Standup **on** Wednesday", "Call Sam **at** 8pm", "Submit **by**
 * Friday", "**due** Wednesday"), which would otherwise strand the connector as an
 * orphaned word in the description. */
const CONNECTOR_WORDS = new Set(["on", "at", "by", "due"]);

function isLetter(ch: string): boolean {
  return /\p{L}/u.test(ch);
}

/** Widens `[start, end)` leftward over one connector word if it sits immediately before
 * the match, separated only by whitespace. Walks the actual preceding word (letters
 * only) rather than matching a fixed-length prefix, so "upon Monday" is correctly left
 * alone — the word directly before the whitespace is "upon", which isn't in
 * `CONNECTOR_WORDS`. */
function extendingLeadingConnector(text: string, start: number, end: number): { readonly start: number; readonly end: number } {
  let beforeWhitespace = start;
  if (beforeWhitespace <= 0) return { start, end };
  while (beforeWhitespace > 0 && /\s/.test(text[beforeWhitespace - 1]!)) {
    beforeWhitespace -= 1;
  }
  if (beforeWhitespace >= start) return { start, end };

  let wordStart = beforeWhitespace;
  while (wordStart > 0 && isLetter(text[wordStart - 1]!)) {
    wordStart -= 1;
  }
  if (wordStart >= beforeWhitespace) return { start, end };
  const word = text.slice(wordStart, beforeWhitespace).toLowerCase();
  if (!CONNECTOR_WORDS.has(word)) return { start, end };
  return { start: wordStart, end };
}

interface DateTimeMatch {
  readonly date: CalendarDate;
  readonly reminder: QuickAddReminder | null;
  readonly start: number;
  readonly end: number;
}

/** Searches `text` (the masked copy); the connector check runs against `original`. */
function firstDateTimeMatch(text: string, original: string): DateTimeMatch | null {
  const results = chrono.parse(text, new Date());
  if (results.length === 0) return null;
  // Leftmost match wins — quick-add has one due-date field, not several, and "the first
  // date phrase the user typed" is the least surprising tie-break.
  const result = results.reduce((leftmost, candidate) => (candidate.index < leftmost.index ? candidate : leftmost));

  const resolved = result.start.date();
  const date: CalendarDate = { year: resolved.getFullYear(), month: resolved.getMonth() + 1, day: resolved.getDate() };
  const hasExplicitTime = result.start.isCertain("hour");
  const reminder: QuickAddReminder | null = hasExplicitTime
    ? { date, time: { hour: resolved.getHours(), minute: resolved.getMinutes() } }
    : null;

  const { start, end } = extendingLeadingConnector(original, result.index, result.index + result.text.length);
  return { date, reminder, start, end };
}

function removeRange(text: string, start: number, end: number): string {
  return text.slice(0, start) + text.slice(end);
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s{2,}/g, " ").trim();
}

export type QuickAddSpanKind = "date" | "priority" | "recurrence" | "tag";

/** One recognised phrase in capture text, as UTF-16 offsets into the input — what a
 * capture field highlights as the user types. */
export interface QuickAddSpan {
  readonly kind: QuickAddSpanKind;
  readonly start: number;
  readonly end: number;
}

interface Matches {
  readonly recurrence: { readonly rule: string; readonly start: number; readonly end: number } | null;
  readonly priority: { readonly priority: Priority; readonly start: number; readonly end: number } | null;
  readonly date: DateTimeMatch | null;
}

/** Recurrence first, then priority, then the date — each later search runs over a copy
 * with the earlier matches blanked to spaces (same length, so offsets still line up with
 * `input`). Order matters: in "every Friday" the date parser would otherwise read
 * "Friday" as a due date. */
function recognise(input: string): Matches {
  let masked = input;
  const blank = (start: number, end: number): void => {
    masked = masked.slice(0, start) + " ".repeat(end - start) + masked.slice(end);
  };
  const recurrence = firstRecurrenceMatch(input);
  if (recurrence !== null) blank(recurrence.start, recurrence.end);
  const priority = firstPriorityMatch(masked);
  if (priority !== null) blank(priority.start, priority.end);
  const date = firstDateTimeMatch(masked, input);
  return { recurrence, priority, date };
}

/** Extracts at most one due-date/time phrase, one `!priority` token and one `every …`
 * recurrence phrase from `input`, removing each from the returned `description`. No
 * `today` parameter: chrono always resolves relative to the real system clock here,
 * matching every real call site; `buildTaskLine` below still takes `today` explicitly,
 * since it genuinely needs it for the `➕` created-date field. */
export function parseQuickAdd(input: string): QuickAddResult {
  const matches = recognise(input);
  const ranges = [matches.recurrence, matches.priority, matches.date]
    .filter((range): range is NonNullable<typeof range> => range !== null)
    .sort((a, b) => b.start - a.start);
  let text = input;
  for (const range of ranges) text = removeRange(text, range.start, range.end);
  return createQuickAddResult({
    description: collapseWhitespace(text),
    dueDate: matches.date?.date ?? null,
    priority: matches.priority?.priority ?? null,
    reminder: matches.date?.reminder ?? null,
    recurrenceRule: matches.recurrence?.rule ?? null,
  });
}

/** Where each recognised phrase sits in `input` — the same matching `parseQuickAdd`
 * uses, so a highlighted phrase is always exactly what leaves the description, plus
 * inline `#tags`, which stay in it but still read as recognised. Sorted by position. */
export function quickAddSpans(input: string): QuickAddSpan[] {
  const matches = recognise(input);
  const spans: QuickAddSpan[] = [];
  if (matches.recurrence !== null) spans.push({ kind: "recurrence", start: matches.recurrence.start, end: matches.recurrence.end });
  if (matches.priority !== null) spans.push({ kind: "priority", start: matches.priority.start, end: matches.priority.end });
  if (matches.date !== null) spans.push({ kind: "date", start: matches.date.start, end: matches.date.end });
  for (const match of input.matchAll(TAG_REGEX)) {
    const start = match.index;
    const end = start + match[0].length;
    if (spans.some((span) => start < span.end && end > span.start)) continue;
    spans.push({ kind: "tag", start, end });
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** Composes a brand-new task line from a `QuickAddResult`: writes an `➕ <today>`
 * created date unconditionally, plus `📅 <due>`/`⏰ <reminder>`/a priority marker when
 * recognised. Reuses `TaskLineParser`/`TaskSerializer` exactly as every other mutation
 * in this package does — splice/insert then re-parse — rather than hand-assembling
 * field syntax. If `configuration.globalFilter` is set and the typed text doesn't
 * already contain it, the filter tag is appended before the first parse attempt would
 * otherwise fail: without it, `parseLine` throws `excludedByGlobalFilter` and the
 * freshly-captured task wouldn't even parse as a task the next time the vault is
 * scanned. */
export function buildQuickAddTaskLine(
  result: QuickAddResult,
  today: CalendarDate,
  configuration: ParserConfiguration = DEFAULT_PARSER_CONFIGURATION,
): ParsedTask {
  let description = result.description;
  let task: ParsedTask;
  try {
    task = parseLine(`- [ ] ${description}`, { configuration });
  } catch (error) {
    if (!(error instanceof ParseError) || error.code !== "excludedByGlobalFilter" || configuration.globalFilter === null) {
      throw error;
    }
    description = description.length === 0 ? configuration.globalFilter : `${description} ${configuration.globalFilter}`;
    task = parseLine(`- [ ] ${description}`, { configuration });
  }

  task = TaskSerializer.setDate(task, "created", today, configuration);
  if (result.dueDate !== null) task = TaskSerializer.setDate(task, "due", result.dueDate, configuration);
  if (result.scheduled !== null) task = TaskSerializer.setDate(task, "scheduled", result.scheduled, configuration);
  if (result.start !== null) task = TaskSerializer.setDate(task, "start", result.start, configuration);
  if (result.reminder !== null) task = TaskSerializer.setReminder(task, { date: result.reminder.date, time: result.reminder.time }, configuration);
  if (result.priority !== null && result.priority !== "normal") task = TaskSerializer.setPriority(task, result.priority, configuration);
  if (result.recurrenceRule !== null) task = TaskSerializer.setRecurrence(task, result.recurrenceRule, configuration);
  return task;
}
