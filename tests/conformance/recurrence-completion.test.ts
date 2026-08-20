import { describe, test, expect } from "vitest";
import { recurrenceCompletionFixtures } from "./corpus.js";

interface RecurrenceCompletionFixture {
  name: string;
  input: string;
  today: string;
  config?: unknown;
  expected?: { completedLine: string; nextInstanceLine: string | null };
  expectRefusal?: boolean;
}

describe("conformance/recurrence-completion", () => {
  const fixtures = recurrenceCompletionFixtures<RecurrenceCompletionFixture>();

  if (fixtures.length === 0) {
    test.skip("all fixtures declared skipped in conformance-skips.json", () => {});
  } else {
    test.each(fixtures.map((f) => [f.id, f.fixture] as const))("%s", (_id, fixture) => {
      // recurrence/ (RecurrenceEngine.complete equivalent) lands in Wave 1 chunk 5.
      expect.fail(`not implemented yet (Wave 1 chunk 5): input = ${JSON.stringify(fixture.input)}`);
    });
  }
});
