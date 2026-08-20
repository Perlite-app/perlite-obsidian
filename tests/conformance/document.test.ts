import { describe, test, expect } from "vitest";
import { documentFixtures } from "./corpus.js";

interface DocumentFixture {
  name: string;
  content: string;
  config?: unknown;
  expected: { taskCount: number };
}

describe("conformance/document", () => {
  const fixtures = documentFixtures<DocumentFixture>();

  if (fixtures.length === 0) {
    test.skip("all fixtures declared skipped in conformance-skips.json", () => {});
  } else {
    test.each(fixtures.map((f) => [f.id, f.fixture] as const))("%s", (_id, fixture) => {
      // DocumentParser.ts lands in Wave 1 chunk 4.
      expect.fail(`not implemented yet (Wave 1 chunk 4): content = ${JSON.stringify(fixture.content)}`);
    });
  }
});
