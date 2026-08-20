// Loads the conformance corpus (git submodule at repo root, from
// github.com/Perlite-app/perlite-conformance) the same way the native Swift app's own
// harness does: category shapes and fixture ids come from index.json, never a hard-coded
// list, and a repo-root conformance-skips.json declares fixtures this implementation
// doesn't support yet — see conformance/REPORT.md for the full convention both
// implementations share.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
export const conformanceRoot = join(repoRoot, "conformance");

type FixtureShape = "line" | "document" | "mutation" | "recurrence-completion";

interface ConformanceIndexCategory {
  name: string;
  shape: FixtureShape;
  file: string;
  count: number;
  ids: string[];
}

interface ConformanceIndex {
  schemaVersion: number;
  totalFixtures: number;
  categories: ConformanceIndexCategory[];
}

interface ConformanceSkip {
  id: string;
  reason: string;
}

function readJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

let cachedIndex: ConformanceIndex | undefined;
export function loadIndex(): ConformanceIndex {
  if (!cachedIndex) {
    try {
      cachedIndex = readJSON<ConformanceIndex>(join(conformanceRoot, "index.json"));
    } catch (error) {
      throw new Error(
        "could not read conformance/index.json — is the corpus submodule initialized? " +
          `(git submodule update --init)\n${String(error)}`,
      );
    }
  }
  return cachedIndex;
}

let cachedSkips: Set<string> | undefined;
export function loadSkips(): Set<string> {
  if (!cachedSkips) {
    try {
      const entries = readJSON<ConformanceSkip[]>(join(repoRoot, "conformance-skips.json"));
      cachedSkips = new Set(entries.map((e) => e.id));
    } catch {
      cachedSkips = new Set();
    }
  }
  return cachedSkips;
}

export interface Identified<T> {
  id: string;
  fixture: T;
}

function decodeCategory<T extends { name: string }>(category: ConformanceIndexCategory): Identified<T>[] {
  const skips = loadSkips();
  const raw = readJSON<T[]>(join(conformanceRoot, "fixtures", category.name, category.file));
  const out: Identified<T>[] = [];
  for (const fixture of raw) {
    const id = `${category.name}/${fixture.name}`;
    if (!skips.has(id)) out.push({ id, fixture });
  }
  return out;
}

function categoriesByShape(shape: FixtureShape): ConformanceIndexCategory[] {
  return loadIndex().categories.filter((c) => c.shape === shape);
}

export function lineFixtures<T extends { name: string }>(): Identified<T>[] {
  return categoriesByShape("line").flatMap((c) => decodeCategory<T>(c));
}
export function documentFixtures<T extends { name: string }>(): Identified<T>[] {
  return categoriesByShape("document").flatMap((c) => decodeCategory<T>(c));
}
export function mutationFixtures<T extends { name: string }>(): Identified<T>[] {
  return categoriesByShape("mutation").flatMap((c) => decodeCategory<T>(c));
}
export function recurrenceCompletionFixtures<T extends { name: string }>(): Identified<T>[] {
  return categoriesByShape("recurrence-completion").flatMap((c) => decodeCategory<T>(c));
}

/** Total fixtures the corpus declares, independent of how many this implementation
 * actually loaded — see index-count.test.ts, which checks executed+skipped against this. */
export function totalDeclaredFixtures(): number {
  return loadIndex().totalFixtures;
}
