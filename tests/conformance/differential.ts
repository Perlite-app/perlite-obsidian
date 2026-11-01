/**
 * The TypeScript side of the conformance corpus's differential fuzzing
 * (`conformance/DIFFERENTIAL.md`): reads generated cases (JSON Lines) and writes this
 * parser's actual results in the shared result shape, one line per case, so
 * `conformance/tools/differential/compare.mjs` can diff them against PerliteCore's
 * (`perlite-roundtrip differential`). Run via `node Scripts/differential.mjs cases.jsonl`.
 */
import { readFileSync } from "node:fs";
import { fixtureConfigToParserConfiguration, type FixtureConfigJSON } from "./fixtureConfig.js";
import { parseLine } from "../../src/parser/TaskLineParser.js";
import { parseDocument, reserializeDocument } from "../../src/parser/DocumentParser.js";
import * as TaskSerializer from "../../src/parser/TaskSerializer.js";
import { complete } from "../../src/recurrence/RecurrenceEngine.js";
import { allTags, type ParsedTask } from "../../src/model/ParsedTask.js";
import { calendarDateToISOString, parseCalendarDate } from "../../src/model/CalendarDate.js";
import { clockTimeToISOString, parseClockTime } from "../../src/model/ClockTime.js";
import { createTaskStatus } from "../../src/model/TaskStatus.js";
import { createTaskTag } from "../../src/model/TaskTag.js";
import type { DateValue } from "../../src/model/DateValue.js";
import type { ReminderValue } from "../../src/model/ReminderValue.js";
import type { Priority } from "../../src/model/Priority.js";
import type { ParserConfiguration } from "../../src/parser/ParserConfiguration.js";

interface Mutation {
  readonly op: string;
  readonly value: string | null;
}

type Case =
  | { readonly id: string; readonly kind: "line"; readonly input: string; readonly config: FixtureConfigJSON }
  | { readonly id: string; readonly kind: "document"; readonly content: string; readonly config: FixtureConfigJSON }
  | { readonly id: string; readonly kind: "mutation"; readonly input: string; readonly config: FixtureConfigJSON; readonly mutations: readonly Mutation[] }
  | { readonly id: string; readonly kind: "completion"; readonly input: string; readonly config: FixtureConfigJSON; readonly today: string };

const dateText = (value: DateValue | null): string | null =>
  value === null ? null : value.kind === "valid" ? calendarDateToISOString(value.date) : `invalid:${value.raw}`;

const reminderText = (value: ReminderValue | null): string | null => {
  if (value === null) return null;
  if (value.kind === "invalid") return `invalid:${value.raw}`;
  return value.time === null ? calendarDateToISOString(value.date) : `${calendarDateToISOString(value.date)} ${clockTimeToISOString(value.time)}`;
};

function lineResult(task: ParsedTask): Record<string, unknown> {
  return {
    isTask: true,
    status: { symbol: task.status.symbol, kind: task.status.kind },
    indent: task.indent,
    listMarker: task.listMarker,
    description: task.description,
    priority: task.priority,
    due: dateText(task.due),
    scheduled: dateText(task.scheduled),
    start: dateText(task.start),
    created: dateText(task.created),
    done: dateText(task.done),
    cancelled: dateText(task.cancelled),
    reminder: reminderText(task.reminder),
    recurrenceRule: task.recurrenceRule,
    onCompletion: task.onCompletion,
    id: task.id,
    blockedBy: [...task.blockedBy],
    tags: task.tags.map((tag) => tag.raw),
    links: task.links.map((link) => ({ target: link.target, alias: link.alias })),
    indentDepth: task.indentDepth,
    serialized: TaskSerializer.serialize(task),
  };
}

function applyMutation(task: ParsedTask, mutation: Mutation, configuration: ParserConfiguration): ParsedTask {
  const date = (value: string | null) => (value === null ? null : parseCalendarDate(value));
  switch (mutation.op) {
    case "setStatus":
      return TaskSerializer.setStatus(task, createTaskStatus(mutation.value ?? " "), configuration);
    case "setDue":
      return TaskSerializer.setDate(task, "due", date(mutation.value), configuration);
    case "setScheduled":
      return TaskSerializer.setDate(task, "scheduled", date(mutation.value), configuration);
    case "setStart":
      return TaskSerializer.setDate(task, "start", date(mutation.value), configuration);
    case "setReminder": {
      if (mutation.value === null) return TaskSerializer.setReminder(task, null, configuration);
      const [day, time] = mutation.value.split(" ");
      const parsedDay = parseCalendarDate(day ?? "");
      if (parsedDay === null) throw new Error("bad reminder value");
      return TaskSerializer.setReminder(task, { date: parsedDay, time: time === undefined ? null : parseClockTime(time) }, configuration);
    }
    case "setPriority":
      return TaskSerializer.setPriority(task, mutation.value as Priority, configuration);
    case "setDescription":
      return TaskSerializer.setDescription(task, mutation.value ?? "", configuration);
    case "addTag":
      return TaskSerializer.addTag(task, createTaskTag(mutation.value ?? ""), configuration);
    case "removeTag":
      return TaskSerializer.removeTag(task, createTaskTag(mutation.value ?? ""), configuration);
    case "setRecurrence":
      return TaskSerializer.setRecurrence(task, mutation.value, configuration);
    default:
      throw new Error(`unknown op ${mutation.op}`);
  }
}

function run(testCase: Case): unknown {
  const configuration = fixtureConfigToParserConfiguration(testCase.config);
  switch (testCase.kind) {
    case "line": {
      let task: ParsedTask;
      try {
        task = parseLine(testCase.input, { configuration });
      } catch {
        return { isTask: false };
      }
      return lineResult(task);
    }
    case "document": {
      const document = parseDocument(testCase.content, "fuzz.md", configuration);
      return {
        taskCount: document.tasks.length,
        frontmatterTags: document.frontmatterTags.map((tag) => tag.raw),
        roundTrips: reserializeDocument(document) === testCase.content,
        tasks: document.tasks.map((task) => ({
          line: task.location?.lineIndex ?? null,
          raw: task.raw,
          description: task.description,
          indentDepth: task.indentDepth,
          allTags: allTags(task)
            .map((tag) => tag.raw)
            .sort(),
          parentHeading: task.parentHeading,
        })),
      };
    }
    case "mutation": {
      let task: ParsedTask;
      try {
        task = parseLine(testCase.input, { configuration });
      } catch {
        return { ok: false, failedAt: -1 };
      }
      for (const [index, mutation] of testCase.mutations.entries()) {
        try {
          task = applyMutation(task, mutation, configuration);
        } catch {
          return { ok: false, failedAt: index };
        }
      }
      return { ok: true, serialized: TaskSerializer.serialize(task) };
    }
    case "completion": {
      let task: ParsedTask;
      try {
        task = parseLine(testCase.input, { configuration });
      } catch {
        return { isTask: false };
      }
      const today = parseCalendarDate(testCase.today);
      if (today === null) throw new Error(`bad today ${testCase.today}`);
      try {
        const result = complete(task, today, configuration);
        return { completedLine: result.completedLine, nextInstanceLine: result.nextInstanceLine };
      } catch {
        return { refused: true };
      }
    }
  }
}

const path = process.argv[2];
if (path === undefined) {
  console.error("usage: differential <cases.jsonl>");
  process.exit(2);
}
const out: string[] = [];
for (const line of readFileSync(path, "utf8").split("\n")) {
  if (line.trim() === "") continue;
  const testCase = JSON.parse(line) as Case;
  let result: unknown;
  try {
    result = run(testCase);
  } catch (error) {
    // A crash is a result too: the other side may not crash on the same input.
    result = { crashed: String(error instanceof Error ? error.message : error) };
  }
  out.push(JSON.stringify({ id: testCase.id, result }));
}
process.stdout.write(out.join("\n") + "\n");
