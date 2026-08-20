// Obsidian's own standard plugin bundler shape (esbuild, CJS output, `obsidian` +
// Electron/CodeMirror externals) — see https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin.
import esbuild from "esbuild";
import process from "node:process";

const banner = `/* Perlite for Obsidian — built from https://github.com/Perlite-app/perlite-obsidian, do not edit main.js directly */`;

const production = process.argv[2] === "production";
const watch = process.argv[2] === "watch";

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
  ],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: production,
});

if (watch) {
  await context.watch();
} else {
  await context.rebuild();
  process.exit(0);
}
