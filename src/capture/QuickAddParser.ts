import * as chrono from "chrono-node";
import type { CalendarDate } from "../model/CalendarDate.js";
import type { ClockTime } from "../model/ClockTime.js";
import type { Priority } from "../model/Priority.js";
import { ParseError } from "../parser/ParserErrors.js";
import { DEFAULT_PARSER_CONFIGURATION, type ParserConfiguration } from "../parser/ParserConfiguration.js";
import { parseLine } from "../parser/TaskLineParser.js";
import * as TaskSerializer from "../parser/TaskSerializer.js";
import type { ParsedTask } from "../model/ParsedTask.js";

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
  /** Never produced by `parse` itself — no deterministic phrase in free text maps
   * unambiguously onto "scheduled" vs "due" vs "start", and a recurrence rule is
   * open-ended text, not a single recognisable token. Exists purely so a capture UI
   * offering explicit controls for every field a task can carry has somewhere to put a
   * user's direct selection alongside the parsed fields. */
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

/** `!highest`/`!lowest`/`!medium`/`!high`/`!low`, case-insensitive — spelled out rather
 * than a bang-count convention since it maps 1:1 onto `Priority`'s five non-`normal`
 * cases with no separate lookup table to keep in sync. Longer names are listed before
 * their own prefixes (`highest` before `high`, `lowest` before `low`) so the regex
 * engine's ordered alternation doesn't match the short form and strand the remaining
 * letters as literal text. */
const PRIORITY_REGEX = /!(highest|lowest|medium|high|low)\b/i;

function firstPriorityMatch(text: string): { readonly priority: Priority; readonly start: number; readonly end: number } | null {
  const match = PRIORITY_REGEX.exec(text);
  if (match === null || match.index === undefined) return null;
  const word = match[1]!.toLowerCase() as Priority;
  return { priority: word, start: match.index, end: match.index + match[0].length };
}

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

function firstDateTimeMatch(text: string): DateTimeMatch | null {
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

  const { start, end } = extendingLeadingConnector(text, result.index, result.index + result.text.length);
  return { date, reminder, start, end };
}

function removeRange(text: string, start: number, end: number): string {
  return text.slice(0, start) + text.slice(end);
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s{2,}/g, " ").trim();
}

/** Extracts at most one due-date/time phrase and at most one `!priority` token from
 * `input`, removing each matched phrase from the returned `description`. No `today`
 * parameter: chrono always resolves relative to the real system clock here, matching
 * every real call site (which passes the actual current date); `buildTaskLine` below
 * still takes `today` explicitly, since it genuinely needs it for the `➕` created-date
 * field. */
export function parseQuickAdd(input: string): QuickAddResult {
  let text = input;

  let priority: Priority | null = null;
  const priorityMatch = firstPriorityMatch(text);
  if (priorityMatch !== null) {
    priority = priorityMatch.priority;
    text = removeRange(text, priorityMatch.start, priorityMatch.end);
  }

  let dueDate: CalendarDate | null = null;
  let reminder: QuickAddReminder | null = null;
  const dateMatch = firstDateTimeMatch(text);
  if (dateMatch !== null) {
    dueDate = dateMatch.date;
    reminder = dateMatch.reminder;
    text = removeRange(text, dateMatch.start, dateMatch.end);
  }

  return createQuickAddResult({ description: collapseWhitespace(text), dueDate, priority, reminder });
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
