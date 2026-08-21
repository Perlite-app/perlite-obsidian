# Testing Perlite inside real Obsidian

Every chunk that built this plugin (Waves 0–3) was verified by `npm run typecheck` +
`npm test` + a clean `npm run build` only — **never by actually running it inside
Obsidian**. There's no browser/UI automation for an Electron+CodeMirror app in the
environment this plugin has been built in, so drag-and-drop, keyboard scope behavior,
hover previews, and real vault writes are all still unverified against the real app.
This document is how a human closes that gap.

## 1. Set up a scratch vault

Use a **throwaway vault you don't care about**, not a real one — early manual testing is
exactly when a write-path bug is most likely to still be lurking.

```sh
mkdir -p ~/ObsidianTestVaults/perlite-dev/.obsidian/plugins
```

Open that folder (`~/ObsidianTestVaults/perlite-dev`) in Obsidian as a new vault
(**File → Open another vault → Open folder as vault**). This creates the rest of
`.obsidian/` for you. Close Obsidian again before the next step — it shouldn't be running
while you first place the plugin.

## 2. Symlink this repo in as the plugin

Standard Obsidian plugin dev loop: symlink the whole repo into the vault's plugin
folder, not individual files, so `npm run dev`'s rebuilt `main.js` (plus the
already-committed `manifest.json`/`styles.css`) are picked up automatically with no copy
step.

```sh
ln -s /Users/dsere/projects/Perlite/perlite-obsidian \
      ~/ObsidianTestVaults/perlite-dev/.obsidian/plugins/perlite
```

## 3. Build and watch

```sh
cd /Users/dsere/projects/Perlite/perlite-obsidian
npm install                # first time only
git submodule update --init  # first time only — populates conformance/
npm run dev                 # esbuild watch mode; leave this running
```

`npm run dev` writes `main.js` in the repo root on every save, which the symlink exposes
to the vault immediately. Keep this terminal open while testing.

## 4. Enable the plugin in Obsidian

Open the vault, then **Settings → Community plugins**. If this is the vault's first
plugin, you'll need to turn off "Restricted mode" first. Find **Perlite** in the
Installed plugins list and toggle it on.

## 5. Reload after a code change

Obsidian doesn't auto-reload a plugin when `main.js` changes on disk. After each edit +
rebuild, either:

- **Settings → Community plugins → toggle Perlite off, then on again** (always works,
  no extra setup), or
- install the community **Hot Reload** plugin once in this same dev vault, which
  auto-reloads any plugin whose folder changes — much faster for a long testing session,
  optional.

A full **Cmd+R / Ctrl+R** (reload app without saving) also works and is sometimes needed
if a change touches `onload`/command registration in a way a plain toggle doesn't
re-run cleanly.

## 6. Seed some test content

Create a few notes with real Tasks-plugin-format lines before testing views, so there's
something to look at — cover the cases the parser/query layers specifically branch on:

```markdown
- [ ] Overdue task 📅 2020-01-01 #task
- [ ] Due today 📅 <TODAY'S DATE> ⏫ #task
- [ ] Due next week 📅 <A DATE ~5 DAYS OUT> #task
- [ ] No date at all #task
- [x] Already done ✅ <YESTERDAY'S DATE> #task
- [ ] Recurring daily 🔁 every day 📅 <TODAY'S DATE> #task
- [ ] Tagged #work #urgent 📅 <TODAY'S DATE> #task
```

Put these across 2–3 files, at least one inside a subfolder, so folder-exclusion
settings and multi-file grouping have something real to exercise.

## 7. What to actually check

Go through this checklist in order — it follows the three build waves, so a failure
early (Wave 1) is worth fixing before chasing something that depends on it (Wave 3).
Use the DevTools console (**Cmd+Option+I / Ctrl+Shift+I**) to catch silent errors; a
plugin exception often shows there with nothing visible in the UI.

### Wave 1 — parsing, list view, write safety

- [ ] Plugin loads with no console error; a **Perlite** ribbon icon / command exists to
      open the list view.
- [ ] The list view shows your seeded tasks split into **Overdue / Today / Upcoming /
      No Date** sections, correctly bucketed.
- [ ] Tapping a task's checkbox marks it done **in the file on disk** — open the note
      directly and confirm the `[x]` and `✅ <date>` landed correctly, with nothing else
      in the file disturbed.
- [ ] Completing the recurring daily task inserts a fresh `- [ ]` next-instance line
      right after the original, with the due date advanced by one day.
- [ ] Tapping a task row (not the checkbox) opens its source note at the right line.
- [ ] **Settings → Perlite**: toggling the global filter off makes an untagged checkbox
      (no `#task`) appear; toggling a folder exclusion hides tasks from that folder.
- [ ] Rename a note to include `.sync-conflict-` (or `(conflicted copy)`) in its
      filename — confirm it's excluded from the task list and surfaced as a non-blocking
      notice, not silently parsed.
- [ ] Icons render as real Lucide shapes (not missing/broken glyphs); priority/date
      colors look distinct and legible in both light and dark themes if you toggle
      Obsidian's own theme.

### Wave 2 — smart lists, keyboard triage, hover, quick capture

- [ ] Open the **smart list hub** — the 6 built-ins (Overdue, Today, Flagged, etc.) show
      with live counts matching what you'd expect from your seeded tasks.
- [ ] Create a new smart list via the **+** button: pick a filter (e.g. `#work` tag),
      grouping, and sort — confirm it appears in the hub and its detail view shows the
      right tasks.
- [ ] Edit that list, reorder it via drag, pin it, then hide/unhide a built-in — confirm
      each persists across a plugin reload (toggle off/on) and check that
      `.perlite/smart-lists.json` now exists in the vault with the expected content.
- [ ] Delete the user-defined list; confirm it's gone from the hub.
- [ ] In the list view, use **J/K** and arrow keys to move selection, confirm a visible
      focus indicator moves with it.
- [ ] Press **C** on a selected task to complete it, **T** to add a tag, **D** to open
      the reschedule palette (should look like a native Obsidian fuzzy-suggest modal),
      **Enter** to open the source note, **Shift+Space** to expand inline context.
- [ ] Click into a text field (e.g. a note's editor, or a modal's input) and confirm none
      of the single-letter shortcuts above fire while it's focused — this is the "never
      hijack typing" requirement.
- [ ] Check **Settings → Hotkeys**, search "Perlite" — the same actions (select next/
      previous, complete, reschedule, tag, open) should appear there too and be
      rebindable.
- [ ] Hover over a task row (with whatever modifier key your **Settings → Page preview**
      is configured to require) and confirm a native-looking preview popover appears.
      Change the Page Preview modifier-key setting and confirm Perlite's hover respects
      the new setting without a plugin restart.
- [ ] Run the **quick capture** command (via the command palette or an assigned
      hotkey), type something like `"Call the dentist tomorrow at 3pm"`, and confirm it
      lands in the configured inbox file with a correctly parsed `📅` date/time field —
      note the plugin's own documented divergence: a bare weekday matching *today's*
      weekday resolves to *today* here (unlike the native app, which resolves to next
      week) — that's expected, not a bug.

### Wave 3 — kanban and calendar lenses

- [ ] Edit a smart list (or create one) and switch its **lens** to **Kanban** — confirm
      it renders as columns instead of a flat list.
- [ ] Confirm each card has a **dedicated drag handle** (not the whole card) — try
      selecting text in a card's title without triggering a drag.
- [ ] Drag a card between columns (grouped by whichever property you picked — status/
      priority/tag/folder) and confirm the underlying file's field actually changed on
      disk to match the new column.
- [ ] Switch the same list's lens to **Calendar** — confirm a month grid renders with
      dots/markers on days that have tasks.
- [ ] Navigate months via the chevron buttons.
- [ ] Drag a task onto a different day and confirm its `📅` field was rewritten in place
      in the source file — and that no other field on that line changed.
- [ ] Switch the lens back to **List** and confirm the same smart list renders as an
      ordinary flat list again with no leftover kanban/calendar state.

### Mobile (isDesktopOnly is false — this matters)

- [ ] If you have Obsidian mobile available (iOS/Android) pointed at a synced copy of
      this same vault, install/enable Perlite there too and repeat at least the Wave 1
      checklist — this is what actually proves no Node/Electron-only API snuck in
      anywhere in the code.

## 8. Reporting back

For anything that fails: note which checklist item, what you expected vs. what
happened, and the exact console error text if there was one — that's normally enough
for a fix without needing to reproduce it blind. If a whole wave passes clean, that's
worth recording too (in `claude-docs/CLAUDE.md`'s status section) so future sessions
don't re-ask for the same verification.
