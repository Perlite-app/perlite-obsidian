import { describe, test, expect } from "vitest";
import { lineFixtures } from "./corpus.js";

interface LineFixture {
  name: string;
  input: string;
  config?: unknown;
  expected: { isTask: boolean };
  serialized?: string;
}

describe("conformance/line", () => {
  const fixtures = lineFixtures<LineFixture>();

  // Vitest errors on test.each([]) rather than silently running zero tests (unlike
  // Swift Testing's @Test(arguments:)) — guard explicitly so "every fixture in this
  // category is declared skipped" is a real, named, skipped test, not a suite failure.
  if (fixtures.length === 0) {
    test.skip("all fixtures declared skipped in conformance-skips.json", () => {});
  } else {
    test.each(fixtures.map((f) => [f.id, f.fixture] as const))("%s", (_id, fixture) => {
      // No parser exists yet — TaskLineParser.ts lands in Wave 1 chunk 2. This is
      // intentionally a real failure, not a skip: it proves this exact fixture's real
      // input flowed through the harness, not that the harness silently did nothing.
      expect.fail(`not implemented yet (Wave 1 chunk 2): input = ${JSON.stringify(fixture.input)}`);
    });
  }
});
