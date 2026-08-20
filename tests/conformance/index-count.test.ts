import { describe, test, expect } from "vitest";
import {
  loadSkips,
  totalDeclaredFixtures,
  lineFixtures,
  documentFixtures,
  mutationFixtures,
  recurrenceCompletionFixtures,
} from "./corpus.js";

// Guards against a partial or empty corpus checkout silently going green — mirrors
// PerliteCore's ConformanceIndexTests exactly (same corpus, same convention, second
// implementation). Before this test existed on the Swift side, an uninitialized
// submodule or an empty fixture directory produced a passing suite, since
// `test.each([])` runs zero tests, not a failure.
describe("conformance/index", () => {
  test("every declared fixture is executed or declared skipped", () => {
    const executed =
      lineFixtures().length +
      documentFixtures().length +
      mutationFixtures().length +
      recurrenceCompletionFixtures().length;
    const declared = totalDeclaredFixtures();
    const skipped = loadSkips().size;

    expect(
      executed + skipped,
      `conformance/index.json declares ${declared} fixture(s) (${skipped} declared skipped in ` +
        `conformance-skips.json), but only ${executed} were loaded and executed. Check the corpus ` +
        "checkout is complete and up to date, and that conformance-skips.json is current.",
    ).toBe(declared);
  });
});
