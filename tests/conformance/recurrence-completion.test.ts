import { describe, test, expect } from "vitest";
import { recurrenceCompletionFixtures } from "./corpus.js";
import { fixtureConfigToParserConfiguration, type FixtureConfigJSON } from "./fixtureConfig.js";
import { parseLine } from "../../src/parser/TaskLineParser.js";
import { complete } from "../../src/recurrence/RecurrenceEngine.js";
import { parseCalendarDate } from "../../src/model/CalendarDate.js";

interface RecurrenceCompletionFixture {
  name: string;
  input: string;
  today: string;
  config?: FixtureConfigJSON;
  expected?: { completedLine: string; nextInstanceLine: string | null };
  expectRefusal?: boolean;
}

describe("conformance/recurrence-completion", () => {
  const fixtures = recurrenceCompletionFixtures<RecurrenceCompletionFixture>();

  if (fixtures.length === 0) {
    test.skip("all fixtures declared skipped in conformance-skips.json", () => {});
  } else {
    test.each(fixtures.map((f) => [f.id, f.fixture] as const))("%s", (_id, fixture) => {
      const configuration = fixtureConfigToParserConfiguration(fixture.config);
      const task = parseLine(fixture.input, { configuration });

      const today = parseCalendarDate(fixture.today);
      if (today === null) {
        throw new Error(`fixture '${fixture.name}' has an unparseable today date`);
      }

      if (fixture.expectRefusal === true) {
        expect(() => complete(task, today, configuration)).toThrow();
        return;
      }

      if (fixture.expected === undefined) {
        throw new Error(`fixture '${fixture.name}' has neither expectRefusal nor expected`);
      }

      const result = complete(task, today, configuration);
      expect(result.completedLine).toBe(fixture.expected.completedLine);
      expect(result.nextInstanceLine).toBe(fixture.expected.nextInstanceLine);
    });
  }
});
