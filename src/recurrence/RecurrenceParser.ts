import { isNumberChar } from "../parser/textScanning.js";
import type { RecurrenceFrequency, RecurrenceRule } from "./RecurrenceRule.js";
import { parseWeekday, type Weekday } from "./Weekday.js";

/**
 * Parses the raw text captured after a task's `🔁` marker into a `RecurrenceRule`, or
 * returns `null` for anything outside the MVP's explicit grammar subset. `null` is not a
 * parse error to work around — it is the exact signal `RecurrenceEngine`'s completion
 * needs to refuse rather than guess at a rule it doesn't actually understand.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Recurrence/RecurrenceParser.swift`.
 */
const WHEN_DONE_SUFFIX = "when done";

export function parseRecurrenceRule(raw: string): RecurrenceRule | null {
  let text = raw.trim().toLowerCase();

  let whenDone = false;
  if (text.endsWith(WHEN_DONE_SUFFIX)) {
    whenDone = true;
    text = text.slice(0, text.length - WHEN_DONE_SUFFIX.length).trim();
  }

  if (!text.startsWith("every")) return null;
  text = text.slice("every".length).trim();
  if (text.length === 0) return null;

  let interval = 1;
  let numberPrefixLength = 0;
  while (numberPrefixLength < text.length && isNumberChar(text[numberPrefixLength]!)) {
    numberPrefixLength += 1;
  }
  if (numberPrefixLength > 0) {
    const numberPrefix = text.slice(0, numberPrefixLength);
    // Mirrors Swift's `Int(numberPrefix)` exactly: the *scan* above uses the same
    // broad Unicode-digit classifier `isNumberChar` uses elsewhere in this port, but
    // the actual numeric conversion only accepts ASCII digits — `Number()` returns NaN
    // for a prefix containing a non-ASCII digit, the same failure `Int(String)` has,
    // not a divergence introduced by this port.
    const parsedInterval = Number(numberPrefix);
    if (!Number.isInteger(parsedInterval) || parsedInterval <= 0) return null;
    interval = parsedInterval;
    text = text.slice(numberPrefixLength).trim();
  }
  if (text.length === 0) return null;

  // Swift's `split(separator: " ", maxSplits: 1)`: split at the first space only,
  // leaving the remainder (which may itself contain more spaces) as one piece.
  const spaceIndex = text.indexOf(" ");
  const unitWord = spaceIndex === -1 ? text : text.slice(0, spaceIndex);
  const restPart = spaceIndex === -1 ? null : text.slice(spaceIndex + 1);
  if (unitWord.length === 0) return null;

  let frequency: RecurrenceFrequency;
  switch (unitWord) {
    case "day":
    case "days":
      frequency = "daily";
      break;
    case "week":
    case "weeks":
      frequency = "weekly";
      break;
    case "month":
    case "months":
      frequency = "monthly";
      break;
    case "year":
    case "years":
      frequency = "yearly";
      break;
    default:
      return null;
  }

  const weekdays: Weekday[] = [];
  if (restPart !== null) {
    const rest = restPart.trim();
    if (frequency !== "weekly" || !rest.startsWith("on ")) return null;
    // .filter(length > 0) matches Swift's split(separator:)'s default
    // omittingEmptySubsequences: true — drops zero-length pieces (e.g. "mon,,wed")
    // without touching a whitespace-only piece (e.g. "mon, ,wed"), which Swift
    // considers non-empty too and which fails weekday parsing identically either way.
    const names = rest
      .slice("on ".length)
      .split(",")
      .filter((name) => name.length > 0);
    if (names.length === 0) return null;
    for (const name of names) {
      const day = parseWeekday(name);
      if (day === null) return null;
      weekdays.push(day);
    }
  }

  return { frequency, interval, weekdays, whenDone };
}
