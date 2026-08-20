import { describe, test, expect } from "vitest";
import { mutationFixtures } from "./corpus.js";

interface MutationFixture {
  name: string;
  input: string;
  config?: unknown;
  mutations: { op: string; value: string | null }[];
  expectedSerialized: string;
}

describe("conformance/mutation", () => {
  const fixtures = mutationFixtures<MutationFixture>();

  if (fixtures.length === 0) {
    test.skip("all fixtures declared skipped in conformance-skips.json", () => {});
  } else {
    test.each(fixtures.map((f) => [f.id, f.fixture] as const))("%s", (_id, fixture) => {
      // TaskSerializer.ts lands in Wave 1 chunk 3.
      expect.fail(`not implemented yet (Wave 1 chunk 3): input = ${JSON.stringify(fixture.input)}`);
    });
  }
});
