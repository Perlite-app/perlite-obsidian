// Runs tests/conformance/differential.ts over a generated cases file and prints this
// parser's results (JSON Lines) — see conformance/DIFFERENTIAL.md.
//
//   node conformance/tools/differential/generate.mjs > /tmp/cases.jsonl
//   node Scripts/differential.mjs /tmp/cases.jsonl > /tmp/typescript.jsonl
import esbuild from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "perlite-differential-"));
const outfile = join(dir, "differential.mjs");
try {
  await esbuild.build({
    entryPoints: [new URL("../tests/conformance/differential.ts", import.meta.url).pathname],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile,
    logLevel: "warning",
  });
  await import(pathToFileURL(outfile).href);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
