import { describe, test, expect } from "vitest";
import { mutationFixtures } from "./corpus.js";
import { fixtureConfigToParserConfiguration, type FixtureConfigJSON } from "./fixtureConfig.js";
import { parseLine } from "../../src/parser/TaskLineParser.js";
import * as TaskSerializer from "../../src/parser/TaskSerializer.js";
import { parseCalendarDate, type CalendarDate } from "../../src/model/CalendarDate.js";
import { parseClockTime, type ClockTime } from "../../src/model/ClockTime.js";
import { createTaskStatus } from "../../src/model/TaskStatus.js";
import { createTaskTag } from "../../src/model/TaskTag.js";
import type { Priority } from "../../src/model/Priority.js";
import type { ParsedTask } from "../../src/model/ParsedTask.js";
import type { ParserConfiguration } from "../../src/parser/ParserConfiguration.js";

interface FixtureMutation {
  op: string;
  value: string | null;
}

interface MutationFixture {
  name: string;
  input: string;
  config?: FixtureConfigJSON;
  mutations: FixtureMutation[];
  expectedSerialized: string;
}

const PRIORITY_VALUES = new Set<Priority>(["highest", "high", "medium", "normal", "low", "lowest"]);
function isPriority(value: string): value is Priority {
  return PRIORITY_VALUES.has(value as Priority);
}

/** Mirrors the Swift conformance harness's own local helper of the same purpose (not
 * `parseReminderValue` from `model/` — a mutation's value is assumed well-formed test
 * data, not something to validate into a valid/invalid `ReminderValue`). */
function parseReminderMutationValue(value: string): { date: CalendarDate; time: ClockTime | null } | null {
  const parts = value.split(" ").filter((p) => p.length > 0);
  const dateText = parts[0];
  if (dateText === undefined) return null;
  const date = parseCalendarDate(dateText);
  if (date === null) return null;
  const timeText = parts[1];
  const time = parts.length === 2 && timeText !== undefined ? parseClockTime(timeText) : null;
  return { date, time };
}

function applyMutation(mutation: FixtureMutation, task: ParsedTask, configuration: ParserConfiguration): ParsedTask {
  switch (mutation.op) {
    case "setStatus": {
      const symbol = mutation.value !== null ? Array.from(mutation.value)[0] : undefined;
      if (symbol === undefined) throw new Error("setStatus requires a single-character value");
      return TaskSerializer.setStatus(task, createTaskStatus(symbol), configuration);
    }
    case "setDue":
      return TaskSerializer.setDate(task, "due", mutation.value !== null ? parseCalendarDate(mutation.value) : null, configuration);
    case "setScheduled":
      return TaskSerializer.setDate(task, "scheduled", mutation.value !== null ? parseCalendarDate(mutation.value) : null, configuration);
    case "setStart":
      return TaskSerializer.setDate(task, "start", mutation.value !== null ? parseCalendarDate(mutation.value) : null, configuration);
    case "setPriority": {
      if (mutation.value === null || !isPriority(mutation.value)) {
        throw new Error("setPriority requires a valid priority value");
      }
      return TaskSerializer.setPriority(task, mutation.value, configuration);
    }
    case "setDescription":
      return TaskSerializer.setDescription(task, mutation.value ?? "", configuration);
    case "addTag": {
      if (mutation.value === null) throw new Error("addTag requires a value");
      return TaskSerializer.addTag(task, createTaskTag(mutation.value), configuration);
    }
    case "removeTag": {
      if (mutation.value === null) throw new Error("removeTag requires a value");
      return TaskSerializer.removeTag(task, createTaskTag(mutation.value), configuration);
    }
    case "setRecurrence":
      return TaskSerializer.setRecurrence(task, mutation.value, configuration);
    case "setReminder":
      return TaskSerializer.setReminder(task, mutation.value !== null ? parseReminderMutationValue(mutation.value) : null, configuration);
    default:
      throw new Error(`unknown mutation op '${mutation.op}'`);
  }
}

describe("conformance/mutation", () => {
  const fixtures = mutationFixtures<MutationFixture>();

  if (fixtures.length === 0) {
    test.skip("all fixtures declared skipped in conformance-skips.json", () => {});
  } else {
    test.each(fixtures.map((f) => [f.id, f.fixture] as const))("%s", (_id, fixture) => {
      const configuration = fixtureConfigToParserConfiguration(fixture.config);
      let task = parseLine(fixture.input, { configuration });
      for (const mutation of fixture.mutations) {
        task = applyMutation(mutation, task, configuration);
      }
      expect(TaskSerializer.serialize(task)).toBe(fixture.expectedSerialized);
    });
  }
});
