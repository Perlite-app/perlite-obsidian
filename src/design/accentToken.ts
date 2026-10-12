/**
 * Resolves an opaque `SmartList.accentToken` (§5's token *name*, never a hex value — see
 * `SmartList.ts`'s own doc comment) to the CSS custom property that carries its actual
 * colour. The property names below are a value copy of
 * `Perlite/DesignSystem/AccentToken.swift`'s `"accent.*"`/`"smartlist.*"` cases, defined
 * in `styles.css`'s `.theme-light`/`.theme-dark` blocks — same discipline as every other
 * fixed-hue token in this codebase.
 */
const ACCENT_TOKEN_VAR: Readonly<Record<string, string>> = {
  "accent.red": "--perlite-accent-red",
  "accent.orange": "--perlite-accent-orange",
  "accent.yellow": "--perlite-accent-yellow",
  "accent.green": "--perlite-accent-green",
  "accent.blue": "--perlite-accent-blue",
  "accent.purple": "--perlite-accent-purple",
  "accent.pink": "--perlite-accent-pink",
  "accent.gray": "--perlite-accent-gray",
  "smartlist.today": "--perlite-smartlist-today",
  "smartlist.overdue": "--perlite-smartlist-overdue",
  "smartlist.upcoming": "--perlite-smartlist-upcoming",
  "smartlist.anytime": "--perlite-smartlist-anytime",
  "smartlist.flagged": "--perlite-smartlist-flagged",
  "smartlist.recentlyCompleted": "--perlite-smartlist-recentlyCompleted",
  "smartlist.blocking": "--perlite-smartlist-blocking",
};

/** Falls back to `--text-muted` for an unrecognised token (e.g. a hand-edited
 * `.perlite/smart-lists.json`) rather than throwing — a display detail shouldn't reject
 * otherwise-valid data. */
export function accentTokenVar(token: string): string {
  return ACCENT_TOKEN_VAR[token] ?? "--text-muted";
}
