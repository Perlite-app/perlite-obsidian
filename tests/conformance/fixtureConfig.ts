import type { ParserConfiguration } from "../../src/parser/ParserConfiguration.js";

/**
 * Decodes a fixture's optional `config` object into a real `ParserConfiguration` — the
 * TS mirror of the Swift test suite's `FixtureConfig`
 * (`PerliteCore/Tests/PerliteCoreTests/ConformanceFixtures.swift`). `globalFilter` needs
 * real three-way handling: key **absent** → the real default (`"#task"`); key present as
 * JSON `null` → filter disabled; key present as a string → that filter. A plain `??`
 * fallback can't tell "absent" and "present but null" apart, which is exactly why this
 * needs its own function rather than a one-liner.
 */
export interface FixtureConfigJSON {
  readonly globalFilter?: string | null;
  readonly filenameAsScheduledDate?: boolean;
  readonly frontmatterTagInheritance?: boolean;
}

export function fixtureConfigToParserConfiguration(config: FixtureConfigJSON | undefined): ParserConfiguration {
  const globalFilter = config !== undefined && "globalFilter" in config ? (config.globalFilter ?? null) : "#task";
  return {
    globalFilter,
    filenameAsScheduledDate: config?.filenameAsScheduledDate ?? false,
    frontmatterTagInheritance: config?.frontmatterTagInheritance ?? false,
    excludedFolders: [],
  };
}
