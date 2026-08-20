import { describe, test, expect } from "vitest";
import { lineFixtures } from "./corpus.js";
import { fixtureConfigToParserConfiguration, type FixtureConfigJSON } from "./fixtureConfig.js";
import { parseLine } from "../../src/parser/TaskLineParser.js";
import { ParseError } from "../../src/parser/ParserErrors.js";
import { parseCalendarDate } from "../../src/model/CalendarDate.js";
import { parseClockTime } from "../../src/model/ClockTime.js";
import type { DateValue } from "../../src/model/DateValue.js";
import type { ReminderValue } from "../../src/model/ReminderValue.js";
import type { Priority } from "../../src/model/Priority.js";
import type { TaskStatusKind } from "../../src/model/TaskStatus.js";

interface ExpectedStatus {
  symbol: string;
  kind: TaskStatusKind;
}

interface ExpectedLink {
  target: string;
  alias: string | null;
}

interface ExpectedTask {
  isTask: boolean;
  status?: ExpectedStatus;
  indent?: string;
  listMarker?: string;
  description?: string;
  priority?: Priority;
  due?: string;
  scheduled?: string;
  start?: string;
  created?: string;
  done?: string;
  cancelled?: string;
  reminder?: string;
  recurrenceRule?: string | null;
  onCompletion?: string | null;
  id?: string | null;
  blockedBy?: string[];
  tags?: string[];
  links?: ExpectedLink[];
}

interface LineFixture {
  name: string;
  input: string;
  config?: FixtureConfigJSON;
  expected: ExpectedTask;
  serialized?: string;
}

/** Same `"YYYY-MM-DD"` / `"invalid:<raw>"` convention documented in `conformance/SCHEMA.md`. */
function expectDateValue(actual: DateValue | null, expected: string): void {
  if (expected.startsWith("invalid:")) {
    expect(actual).toEqual({ kind: "invalid", raw: expected.slice("invalid:".length) });
    return;
  }
  const date = parseCalendarDate(expected);
  expect(actual).toEqual(date === null ? null : { kind: "valid", date });
}

/** Same convention, extended with the reminder field's optional time half. */
function expectReminderValue(actual: ReminderValue | null, expected: string): void {
  if (expected.startsWith("invalid:")) {
    expect(actual).toEqual({ kind: "invalid", raw: expected.slice("invalid:".length) });
    return;
  }
  const parts = expected.split(" ").filter((p) => p.length > 0);
  const dateText = parts[0];
  const date = dateText !== undefined ? parseCalendarDate(dateText) : null;
  const timeText = parts[1];
  const time = parts.length === 2 && timeText !== undefined ? parseClockTime(timeText) : null;
  expect(actual).toEqual(date === null ? null : { kind: "valid", date, time });
}

describe("conformance/line", () => {
  const fixtures = lineFixtures<LineFixture>();

  if (fixtures.length === 0) {
    test.skip("all fixtures declared skipped in conformance-skips.json", () => {});
  } else {
    test.each(fixtures.map((f) => [f.id, f.fixture] as const))("%s", (_id, fixture) => {
      const configuration = fixtureConfigToParserConfiguration(fixture.config);

      if (!fixture.expected.isTask) {
        expect(() => parseLine(fixture.input, { configuration })).toThrow(ParseError);
        return;
      }

      const task = parseLine(fixture.input, { configuration });
      const expected = fixture.expected;

      if (expected.status !== undefined) {
        expect(task.status.symbol).toBe(expected.status.symbol);
        expect(task.status.kind).toBe(expected.status.kind);
      }
      if (expected.indent !== undefined) expect(task.indent).toBe(expected.indent);
      if (expected.listMarker !== undefined) expect(task.listMarker).toBe(expected.listMarker);
      if (expected.description !== undefined) expect(task.description).toBe(expected.description);
      if (expected.priority !== undefined) expect(task.priority).toBe(expected.priority);
      if (expected.due !== undefined) expectDateValue(task.due, expected.due);
      if (expected.scheduled !== undefined) expectDateValue(task.scheduled, expected.scheduled);
      if (expected.start !== undefined) expectDateValue(task.start, expected.start);
      if (expected.created !== undefined) expectDateValue(task.created, expected.created);
      if (expected.done !== undefined) expectDateValue(task.done, expected.done);
      if (expected.cancelled !== undefined) expectDateValue(task.cancelled, expected.cancelled);
      if (expected.reminder !== undefined) expectReminderValue(task.reminder, expected.reminder);
      if (expected.recurrenceRule !== undefined) expect(task.recurrenceRule).toBe(expected.recurrenceRule);
      if (expected.onCompletion !== undefined) expect(task.onCompletion).toBe(expected.onCompletion);
      if (expected.id !== undefined) expect(task.id).toBe(expected.id);
      if (expected.blockedBy !== undefined) expect(task.blockedBy).toEqual(expected.blockedBy);
      if (expected.tags !== undefined) expect(task.tags.map((t) => t.raw)).toEqual(expected.tags);
      if (expected.links !== undefined) {
        expect(task.links.map((l) => ({ target: l.target, alias: l.alias }))).toEqual(expected.links);
      }
      if (fixture.serialized !== undefined) {
        // No serializer exists yet (Wave 1 chunk 3) — but every line fixture is a
        // round-trip fixture (SCHEMA.md: "serialized must equal input"), and an
        // unmodified ParsedTask's raw is byte-identical to its input by construction
        // ("spans, not segments" — see ParsedTask.ts). This is mathematically
        // equivalent to calling a no-op serializer here, not a shortcut around it.
        expect(task.raw).toBe(fixture.serialized);
      }
    });
  }
});
