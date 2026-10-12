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

### Design pass — main tab, lenses and Task sidebars, board, calendar, Quick add

The October 2026 design pass replaced the old list/kanban/calendar views with one main
tab (List / Board / Calendar) plus two sidebar views. Run each item in a light **and** a
dark theme (and a third-party theme like **Minimal** if you have one) — every colour
should come from the theme; nothing should look hard-coded.

- [ ] The ribbon icon opens the **Perlite** tab and adds **Perlite lenses** (left
      sidebar) and **Task** (right sidebar). The tab title is the lens name.
- [ ] Lenses sidebar: Today / Upcoming / No date / High priority / All tasks, then smart
      lists, tags and notes, each with an open count. Picking one switches the tab; the
      choice is still selected after reloading Obsidian.
- [ ] List: the ring and "x of y done" match; **Group by** Note / Due / Priority works.
      The Up next card's **Done** completes it in the file; **Details** shows it in the
      Task sidebar.
- [ ] List capture field: type `Order toner tomorrow !! every week #work` — each phrase
      is tinted *exactly* under the text as you type (also when it wraps to a second
      line), and the line under it is what lands in the file. Enter adds it; on the
      Today lens the task is due today; on a note lens it goes into that note. Keep
      typing the next task immediately — focus must stay in the field.
- [ ] Rows: click selects (Task sidebar follows), double-click opens the note at the
      line, the ring completes. J/K/C/D/T/Enter still work, and the Task sidebar
      follows J/K.
- [ ] Task sidebar: status To do / Doing / Done / Cancel write `[ ]` / `[/]` / `[x]` /
      `[-]`; Due / Scheduled / Starts open the date palette (try typing "next friday");
      Tags adds a tag; priority control writes the marker; "Open … at line N" works.
- [ ] Board: columns by Status / Priority / Note; drag a card to another status or
      priority column and check the line on disk; the toast's **Undo** puts it back.
      Each card's ⋯ menu offers the same moves (this is the mobile path). Clicking a
      card title opens the note *beside* the board, reusing one split. Cancelled starts
      folded; Note columns don't accept drops.
- [ ] Calendar: Week / Month; Place by 📅 / ⏳ / 🛫; drag a task to another day and
      check only that field changed; drag it to the **No … date** tray to remove the
      field; Undo. The lenses sidebar shows a mini month in Calendar mode — picking a
      day moves the week.
- [ ] Quick add (**Perlite: New task**, no default hotkey): tinted field, `#` opens the
      tag popover (Tab or Enter accepts), chips remove their phrase, **Save to** picks a
      note, Enter adds and stays open, Cmd/Ctrl+Enter adds and closes.
- [ ] Status bar shows "Perlite: N left today"; clicking it opens Today.
- [ ] Keyboard only: every control in the tab and both sidebars shows a focus ring.
- [ ] Narrow pane: the header, toolbars and calendar wrap instead of clipping.

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
