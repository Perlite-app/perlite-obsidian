import { describe, expect, test } from "vitest";
import { calendarDateToISOString, type CalendarDate } from "../../../src/model/CalendarDate.js";
import { addDays, nextOccurrenceOfWeekday } from "../../../src/recurrence/RecurrenceCalculator.js";
import { parseWeekday, WEEKDAY_VALUES } from "../../../src/recurrence/Weekday.js";
import { DEFAULT_PARSER_CONFIGURATION, type ParserConfiguration } from "../../../src/parser/ParserConfiguration.js";
import { buildQuickAddTaskLine, createQuickAddResult, parseQuickAdd } from "../../../src/capture/QuickAddParser.js";

/**
 * Behavioural port of `PerliteCoreTests/QuickAddParserTests.swift` — asserts relative to
 * the real system clock at suite-run time, same accepted tradeoff that suite's own doc
 * comment states for `NSDataDetector`; `chrono-node` has the identical "no reference-
 * date injection" constraint.
 *
 * One **confirmed, real divergence from the native suite**, found during this port's own
 * research spike rather than assumed: `NSDataDetector` resolves a bare weekday name
 * matching *today's* actual weekday to *next week's* occurrence; `chrono-node` resolves
 * it to *today* (verified directly — see `QuickAddParser.ts`'s own doc comment). The
 * native test `bareWeekdayMatchingTodayResolvesToNextWeeksOccurrence` is therefore
 * **not** ported verbatim; `bareWeekdayMatchingTodayResolvesToToday` below asserts this
 * library's actual behaviour instead.
 */

function today(): CalendarDate {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function todaysWeekdayName(): string {
  return WEEKDAY_VALUES[new Date().getDay()]!;
}

/** A weekday name guaranteed not to be today's. */
function otherWeekdayName(): string {
  return WEEKDAY_VALUES[(new Date().getDay() + 1) % 7]!;
}

describe("parseQuickAdd", () => {
  test("recognises today", () => {
    const result = parseQuickAdd("Water plants today");
    expect(result.dueDate).toEqual(today());
    expect(result.description).toBe("Water plants");
    expect(result.reminder).toBeNull();
  });

  test("recognises tomorrow", () => {
    const result = parseQuickAdd("Water plants tomorrow");
    expect(result.dueDate).toEqual(addDays(1, today()));
    expect(result.description).toBe("Water plants");
  });

  test("a bare weekday matching today's actual weekday resolves to today", () => {
    const result = parseQuickAdd(`Standup ${todaysWeekdayName()}`);
    expect(result.dueDate).toEqual(today());
    expect(result.description).toBe("Standup");
  });

  test("a bare weekday resolves to its nearest future occurrence", () => {
    const weekday = parseWeekday(otherWeekdayName())!;
    const result = parseQuickAdd(`Standup ${otherWeekdayName()}`);
    expect(result.dueDate).toEqual(nextOccurrenceOfWeekday(weekday, today(), false));
    expect(result.description).toBe("Standup");
  });

  test("a leading 'on' connector is stripped along with the date phrase it introduces", () => {
    const result = parseQuickAdd(`Standup on ${otherWeekdayName()}`);
    expect(result.dueDate).not.toBeNull();
    expect(result.description).toBe("Standup");
  });

  test("'on' is not stripped when it's part of another word", () => {
    // "upon" must not be mistaken for the "on" connector.
    const result = parseQuickAdd(`Call Sam upon ${otherWeekdayName()} arrival`);
    expect(result.dueDate).not.toBeNull();
    expect(result.description).toBe("Call Sam upon arrival");
  });

  test("an 'at' connector is stripped before a bare time", () => {
    const result = parseQuickAdd("Call Sam at 8pm");
    expect(result.dueDate).toEqual(today());
    expect(result.reminder?.time).toEqual({ hour: 20, minute: 0 });
    expect(result.description).toBe("Call Sam");
  });

  test("recognises an explicit ISO date", () => {
    const future = addDays(30, today())!;
    const result = parseQuickAdd(`Renew passport ${calendarDateToISOString(future)}`);
    expect(result.dueDate).toEqual(future);
    expect(result.description).toBe("Renew passport");
  });

  test("an invalid calendar date is left as plain text", () => {
    const result = parseQuickAdd("Nonsense 2026-13-40 date");
    expect(result.dueDate).toBeNull();
    expect(result.description).toBe("Nonsense 2026-13-40 date");
  });

  test("no date phrase leaves the description untouched", () => {
    const result = parseQuickAdd("Buy milk");
    expect(result.dueDate).toBeNull();
    expect(result.description).toBe("Buy milk");
  });

  describe("time / reminder recognition", () => {
    test("a weekday with an explicit time sets both due date and reminder", () => {
      const weekday = parseWeekday(otherWeekdayName())!;
      const expectedDate = nextOccurrenceOfWeekday(weekday, today(), false)!;
      const result = parseQuickAdd(`Standup ${otherWeekdayName()} at 20:15`);
      expect(result.dueDate).toEqual(expectedDate);
      expect(result.reminder?.date).toEqual(expectedDate);
      expect(result.reminder?.time).toEqual({ hour: 20, minute: 15 });
      expect(result.description).toBe("Standup");
    });

    test("a twelve-hour clock time is recognised", () => {
      const result = parseQuickAdd(`Call Sam ${otherWeekdayName()} at 8pm`);
      expect(result.reminder?.time).toEqual({ hour: 20, minute: 0 });
    });

    test("a bare date with no time sets no reminder", () => {
      const result = parseQuickAdd("Water plants tomorrow");
      expect(result.dueDate).not.toBeNull();
      expect(result.reminder).toBeNull();
    });
  });

  describe("priority shorthand", () => {
    test("recognises the priority shorthand case-insensitively", () => {
      const result = parseQuickAdd("Ship release !HIGH");
      expect(result.priority).toBe("high");
      expect(result.description).toBe("Ship release");
    });

    test("a longer priority name wins over its own prefix", () => {
      const highest = parseQuickAdd("Fix outage !highest");
      expect(highest.priority).toBe("highest");
      expect(highest.description).toBe("Fix outage");

      const lowest = parseQuickAdd("Someday maybe !lowest");
      expect(lowest.priority).toBe("lowest");
      expect(lowest.description).toBe("Someday maybe");
    });
  });

  test("inline tags are left in place, not extracted", () => {
    const result = parseQuickAdd("Buy milk #errands");
    expect(result.dueDate).toBeNull();
    expect(result.priority).toBeNull();
    expect(result.description).toBe("Buy milk #errands");
  });

  test("combines date, tag, and priority, cleaning up whitespace", () => {
    const result = parseQuickAdd("Buy milk tomorrow #errands !high");
    expect(result.dueDate).toEqual(addDays(1, today()));
    expect(result.priority).toBe("high");
    expect(result.description).toBe("Buy milk #errands");
  });
});

describe("buildQuickAddTaskLine", () => {
  test("writes the created date unconditionally", () => {
    const result = parseQuickAdd("Buy milk #task");
    const task = buildQuickAddTaskLine(result, today(), DEFAULT_PARSER_CONFIGURATION);
    expect(task.created?.kind === "valid" ? task.created.date : null).toEqual(today());
    expect(task.raw).toContain(`➕ ${calendarDateToISOString(today())}`);
  });

  test("writes due date and priority when present", () => {
    const result = parseQuickAdd("Ship release tomorrow #task !highest");
    const task = buildQuickAddTaskLine(result, today(), DEFAULT_PARSER_CONFIGURATION);
    expect(task.due?.kind === "valid" ? task.due.date : null).toEqual(addDays(1, today()));
    expect(task.priority).toBe("highest");
  });

  test("writes a reminder when present", () => {
    const result = parseQuickAdd(`Standup ${otherWeekdayName()} at 20:15 #task`);
    const task = buildQuickAddTaskLine(result, today(), DEFAULT_PARSER_CONFIGURATION);
    expect(task.reminder?.kind === "valid" ? task.reminder.time : null).toEqual({ hour: 20, minute: 15 });
    expect(task.reminder?.kind === "valid" ? task.reminder.date : null).toEqual(task.due?.kind === "valid" ? task.due.date : null);
  });

  test("writes scheduled/start/recurrence when present", () => {
    // None of these three come from `parseQuickAdd` itself — they only ever arrive via
    // `createQuickAddResult`'s explicit fields, the same path a UI control writes into.
    const result = createQuickAddResult({
      description: "Ship release #task",
      scheduled: today(),
      start: addDays(-2, today()),
      recurrenceRule: "every week",
    });
    const task = buildQuickAddTaskLine(result, today(), DEFAULT_PARSER_CONFIGURATION);
    expect(task.scheduled?.kind === "valid" ? task.scheduled.date : null).toEqual(today());
    expect(task.start?.kind === "valid" ? task.start.date : null).toEqual(addDays(-2, today()));
    expect(task.recurrenceRule).toBe("every week");
  });

  test("auto-appends a missing global filter tag so the task still parses", () => {
    const result = parseQuickAdd("Buy milk");
    const task = buildQuickAddTaskLine(result, today(), DEFAULT_PARSER_CONFIGURATION);
    expect(task.raw).toContain("#task");
  });

  test("does not duplicate an already-typed global filter tag", () => {
    const result = parseQuickAdd("Buy milk #task");
    const task = buildQuickAddTaskLine(result, today(), DEFAULT_PARSER_CONFIGURATION);
    expect(task.raw.split("#task")).toHaveLength(2);
  });

  test("works with the global filter disabled", () => {
    const configuration: ParserConfiguration = { ...DEFAULT_PARSER_CONFIGURATION, globalFilter: null };
    const result = parseQuickAdd("Buy milk");
    const task = buildQuickAddTaskLine(result, today(), configuration);
    expect(task.description).toBe("Buy milk");
  });
});
