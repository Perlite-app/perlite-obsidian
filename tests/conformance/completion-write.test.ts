import { describe, test, expect } from "vitest";
import { completionWriteFixtures } from "./corpus.js";
import { fixtureConfigToParserConfiguration, type FixtureConfigJSON } from "./fixtureConfig.js";
import { parseDocument } from "../../src/parser/DocumentParser.js";
import { parseCalendarDate } from "../../src/model/CalendarDate.js";
import { complete } from "../../src/recurrence/RecurrenceEngine.js";
import { applyEdit, completionEdit, inverseEdit, type NextInstancePlacement } from "../../src/write/documentEditor.js";

interface CompletionWriteFixture {
  name: string;
  content: string;
  line: number;
  today: string;
  config?: FixtureConfigJSON;
  placement?: NextInstancePlacement;
  expectedContent: string;
}

describe("conformance/completion-write", () => {
  const fixtures = completionWriteFixtures<CompletionWriteFixture>();

  if (fixtures.length === 0) {
    test.skip("all fixtures declared skipped in conformance-skips.json", () => {});
  } else {
    test.each(fixtures.map((f) => [f.id, f.fixture] as const))("%s", (_id, fixture) => {
      const configuration = fixtureConfigToParserConfiguration(fixture.config);
      const document = parseDocument(fixture.content, fixture.name, configuration);
      const task = document.tasks.find((t) => t.location?.lineIndex === fixture.line);
      expect(task).toBeDefined();
      const today = parseCalendarDate(fixture.today);
      expect(today).not.toBeNull();
      const edit = completionEdit(task!.raw, complete(task!, today!, configuration), fixture.placement ?? "above");

      const written = applyEdit(edit, document, fixture.line);
      expect(written).toBe(fixture.expectedContent);
      expect(applyEdit(inverseEdit(edit), parseDocument(written, fixture.name, configuration), fixture.line)).toBe(fixture.content);
    });
  }
});
