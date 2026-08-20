import { describe, test, expect } from "vitest";
import { documentFixtures } from "./corpus.js";
import { fixtureConfigToParserConfiguration, type FixtureConfigJSON } from "./fixtureConfig.js";
import { parseDocument, reserializeDocument } from "../../src/parser/DocumentParser.js";
import { allTags } from "../../src/model/ParsedTask.js";

interface ExpectedDocumentTask {
  description?: string;
  indentDepth?: number;
  allTags?: string[];
  /** Three-way like `config.globalFilter`: key absent means "don't check"; present as
   * JSON `null` means "assert no parent heading"; present as a string means "assert
   * this heading." Checked at the call site via `"parentHeading" in expectedTask`,
   * since a plain optional-field type can't distinguish absent from `undefined` at
   * runtime the way a real `in` check against the parsed JSON object can. */
  parentHeading?: string | null;
}

interface ExpectedDocument {
  taskCount: number;
  frontmatterTags?: string[];
  tasks?: ExpectedDocumentTask[];
}

interface DocumentFixture {
  name: string;
  content: string;
  config?: FixtureConfigJSON;
  expected: ExpectedDocument;
}

describe("conformance/document", () => {
  const fixtures = documentFixtures<DocumentFixture>();

  if (fixtures.length === 0) {
    test.skip("all fixtures declared skipped in conformance-skips.json", () => {});
  } else {
    test.each(fixtures.map((f) => [f.id, f.fixture] as const))("%s", (_id, fixture) => {
      const configuration = fixtureConfigToParserConfiguration(fixture.config);
      const document = parseDocument(fixture.content, fixture.name, configuration);

      expect(document.tasks.length).toBe(fixture.expected.taskCount);
      expect(reserializeDocument(document)).toBe(fixture.content);

      if (fixture.expected.frontmatterTags !== undefined) {
        expect(document.frontmatterTags.map((t) => t.raw)).toEqual(fixture.expected.frontmatterTags);
      }

      if (fixture.expected.tasks !== undefined) {
        fixture.expected.tasks.forEach((expectedTask, index) => {
          if (index >= document.tasks.length) return;
          const task = document.tasks[index]!;

          if (expectedTask.description !== undefined) {
            expect(task.description).toBe(expectedTask.description);
          }
          if (expectedTask.indentDepth !== undefined) {
            expect(task.indentDepth).toBe(expectedTask.indentDepth);
          }
          if (expectedTask.allTags !== undefined) {
            expect(allTags(task).map((t) => t.raw).slice().sort()).toEqual(expectedTask.allTags.slice().sort());
          }
          if ("parentHeading" in expectedTask) {
            expect(task.parentHeading).toBe(expectedTask.parentHeading);
          }
        });
      }
    });
  }
});
