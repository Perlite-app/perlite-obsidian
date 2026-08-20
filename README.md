# Perlite for Obsidian

The Obsidian companion to [Perlite](https://github.com/Perlite-app), a native iOS/macOS
task app that reads and writes the [Obsidian Tasks](https://publish.obsidian.md/tasks/)
plugin markdown format directly in your vault. This plugin brings the same
byte-exact, conformance-tested parser to Obsidian itself — desktop and mobile.

**Status: Wave 1 complete** — model/parser/serializer/document-parser/recurrence engine
ported and passing the full conformance corpus; a design system (Lucide icons via
Obsidian's own `setIcon`, accent tokens matching the native app's "Refined Stock"
palette); the write-safety layer (`Vault.process`-based coordinated writes, sync-conflict
detection, folder exclusions); and a working list view (Overdue/Today/Upcoming/No Date,
tap to complete, tap to open source note) with a settings tab (global filter, folder
exclusions). Not yet manually verified against a real running Obsidian install — see
"Development" below. Wave 2 (user-defined smart lists, keyboard triage, quick capture)
not yet started. See [`Perlite-app/perlite-app`](https://github.com/Perlite-app)'s
`claude-docs/perlite-obsidian-plugin-plan.md` for the full build plan this repo follows
(not tracked here — it's project-planning context for the native app repo, not a
plugin-user-facing document).

## Why a shared conformance corpus

[`conformance/`](conformance/) is a git submodule of
[`Perlite-app/perlite-conformance`](https://github.com/Perlite-app/perlite-conformance)
— the same fixture corpus the native Swift parser is tested against. A parser change
here is not "done" until it passes the same fixtures the native app passes; see
`conformance/SCHEMA.md` for the fixture format and `conformance/REPORT.md` for the
tooling that keeps this contract enforceable rather than just documented.

## Development

```sh
git clone --recurse-submodules https://github.com/Perlite-app/perlite-obsidian.git
# or, if already cloned without it:
git submodule update --init

npm install
./Scripts/test.sh   # typecheck + full test suite, including the conformance corpus
npm run dev          # esbuild watch mode
```

`conformance-skips.json` declares which fixtures this implementation doesn't support
yet, each with a reason — see `conformance/REPORT.md`'s "declared skips" convention.
Currently empty: every fixture category the corpus defines is covered.

GPL-3.0 licensed — see `LICENSE`. (`conformance/`, consumed as a submodule, is a
separate, MIT-licensed repo.)
