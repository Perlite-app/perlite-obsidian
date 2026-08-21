# Perlite for Obsidian

The Obsidian companion to [Perlite](https://github.com/Perlite-app), a native iOS/macOS
task app that reads and writes the [Obsidian Tasks](https://publish.obsidian.md/tasks/)
plugin markdown format directly in your vault. This plugin brings the same
byte-exact, conformance-tested parser to Obsidian itself — desktop and mobile.

**Status: Waves 1, 2, and 3 complete.** Wave 1: model/parser/serializer/document-parser/
recurrence engine ported and passing the full conformance corpus; a design system
(Lucide icons via Obsidian's own `setIcon`, accent tokens matching the native app's
"Refined Stock" palette); the write-safety layer (`Vault.process`-based coordinated
writes, sync-conflict detection, folder exclusions); a working list view (Overdue/Today/
Upcoming/No Date, tap to complete, tap to open source note) with a settings tab (global
filter, folder exclusions). Wave 2: the query engine (`FilterEngine`/`GroupingEngine`/
`SortEngine`/`SmartListEngine`) and a hand-written wire format for user-defined smart
lists, stored in the vault itself (`.perlite/smart-lists.json` — not the plugin's own
`data.json`, so a future Android/Kotlin implementation reads the same file), with a
create/edit/delete/hide/reorder UI; keyboard-first triage (`J`/`K`/arrows/`Enter`/`C`/
`D`/`T`/`Shift+Space`) bound through a view-scoped `Scope`, also registered as rebindable
commands; inline context hover via the native `hover-link` event; and a quick-capture
command using `chrono-node` for date/time recognition (a small research spike found it
matches or exceeds the native app's own `NSDataDetector`-based Tier 1). Wave 3: a
kanban lens (columns grouped by any property, drag-to-recategorize via a dedicated
drag handle, not the whole card) and a calendar lens (month grid, drag-to-reschedule
rewriting the `📅` field in place), both selectable per smart list via a new `lens`
field — "one query, many renderers." **Not yet manually verified against a real running
Obsidian install** — see [`TESTING.md`](TESTING.md) for how to do that pass. See
[`Perlite-app/perlite-app`](https://github.com/Perlite-app)'s
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

To actually run the plugin inside Obsidian (not just typecheck/test/build it), see
[`TESTING.md`](TESTING.md) — a scratch-vault setup and a wave-by-wave manual
verification checklist, since no browser/UI automation exists for an Electron+CodeMirror
app in the environment this plugin has been built in.

`conformance-skips.json` declares which fixtures this implementation doesn't support
yet, each with a reason — see `conformance/REPORT.md`'s "declared skips" convention.
Currently empty: every fixture category the corpus defines is covered.

GPL-3.0 licensed — see `LICENSE`. (`conformance/`, consumed as a submodule, is a
separate, MIT-licensed repo.)
