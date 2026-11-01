import { describe, test, expect } from "vitest";
import { insertionFixtures } from "./corpus.js";
import { fixtureConfigToParserConfiguration, type FixtureConfigJSON } from "./fixtureConfig.js";
import { parseDocument } from "../../src/parser/DocumentParser.js";
import { appendEdit, applyEdit, insertEdit } from "../../src/write/documentEditor.js";

interface InsertionFixture {
  name: string;
  content: string;
  config?: FixtureConfigJSON;
  heading?: { text: string; level: number; line: number };
  insert: string;
  expectedContent?: string;
  expectNotFound?: boolean;
}

describe("conformance/insertion", () => {
  const fixtures = insertionFixtures<InsertionFixture>();

  if (fixtures.length === 0) {
    test.skip("all fixtures declared skipped in conformance-skips.json", () => {});
  } else {
    test.each(fixtures.map((f) => [f.id, f.fixture] as const))("%s", (_id, fixture) => {
      const document = parseDocument(fixture.content, fixture.name, fixtureConfigToParserConfiguration(fixture.config));
      const plan =
        fixture.heading === undefined
          ? appendEdit(fixture.insert, document)
          : insertEdit(fixture.insert, { lineIndex: fixture.heading.line, level: fixture.heading.level, text: fixture.heading.text }, document);

      if (fixture.expectNotFound === true) {
        expect(plan).toBeNull();
        return;
      }
      expect(plan).not.toBeNull();
      expect(applyEdit(plan!.edit, document, plan!.preferringLineIndex)).toBe(fixture.expectedContent);
    });
  }
});
