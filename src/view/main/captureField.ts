import { buildQuickAddTaskLine, parseQuickAdd, quickAddSpans, type QuickAddResult } from "../../capture/QuickAddParser.js";
import type { CalendarDate } from "../../model/CalendarDate.js";
import type { LensCaptureDefaults } from "../../query/lenses.js";
import { serialize } from "../../parser/TaskSerializer.js";
import { parserConfiguration, type PerliteSettings } from "../../settings.js";

/**
 * The design pass's capture field: free text with every phrase the parser recognises
 * tinted in place as you type (a date, `!priority`, `every …`, `#tags`). A `<textarea>`
 * can't colour ranges of its own text, so the tinted copy is drawn in a mirror element
 * underneath and the textarea sits exactly on top with transparent text — it still owns
 * the caret, selection, IME and undo. Both share one CSS grid cell, so the textarea
 * grows with the mirror. Newlines are stripped: one task per capture.
 */

export interface CaptureFieldOptions {
  readonly placeholder: string;
  readonly initial?: string;
  readonly label: string;
  readonly large?: boolean;
  readonly onChange: (value: string) => void;
  readonly onKeyDown?: (event: KeyboardEvent) => void;
}

export interface CaptureField {
  readonly inputEl: HTMLTextAreaElement;
  value(): string;
  setValue(value: string): void;
  focus(): void;
}

export function renderCaptureField(container: HTMLElement, options: CaptureFieldOptions): CaptureField {
  const wrap = container.createDiv({ cls: "perlite-capture" });
  wrap.toggleClass("is-large", options.large === true);
  const mirror = wrap.createDiv({ cls: "perlite-capture__mirror", attr: { "aria-hidden": "true" } });
  const input = wrap.createEl("textarea", {
    cls: "perlite-capture__input",
    attr: { rows: "1", spellcheck: "false", placeholder: options.placeholder, "aria-label": options.label },
  });
  input.value = options.initial ?? "";

  const paint = (): void => {
    const text = input.value;
    mirror.empty();
    let cursor = 0;
    for (const span of quickAddSpans(text)) {
      if (span.start > cursor) mirror.appendText(text.slice(cursor, span.start));
      mirror.createSpan({ cls: `perlite-token perlite-token--${span.kind}`, text: text.slice(span.start, span.end) });
      cursor = span.end;
    }
    // A trailing space (or an empty field) still needs a glyph's height and width.
    mirror.appendText(`${text.slice(cursor)}​`);
    mirror.scrollTop = input.scrollTop;
  };

  input.addEventListener("input", () => {
    if (input.value.includes("\n")) {
      const caret = input.selectionStart - (input.value.slice(0, input.selectionStart).match(/\n/g)?.length ?? 0);
      input.value = input.value.replace(/\n/g, " ");
      input.setSelectionRange(caret, caret);
    }
    paint();
    options.onChange(input.value);
  });
  input.addEventListener("scroll", () => {
    mirror.scrollTop = input.scrollTop;
  });
  if (options.onKeyDown !== undefined) input.addEventListener("keydown", options.onKeyDown);
  paint();

  return {
    inputEl: input,
    value: () => input.value,
    setValue: (value: string) => {
      input.value = value;
      paint();
      options.onChange(value);
    },
    focus: () => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    },
  };
}

/** The parse with the lens's defaults filling whatever the text left unsaid. Tags go
 * into the description, where the vault convention keeps them. */
export function parseWithDefaults(text: string, defaults: LensCaptureDefaults | null, today: CalendarDate): QuickAddResult {
  const parsed = parseQuickAdd(text);
  if (defaults === null) return parsed;
  const needsTag = defaults.tag !== null && !parsed.description.toLowerCase().split(/\s+/).includes(defaults.tag.toLowerCase());
  return {
    ...parsed,
    description: needsTag ? `${parsed.description} ${defaults.tag}`.trim() : parsed.description,
    dueDate: parsed.dueDate ?? (defaults.dueToday ? today : null),
    priority: parsed.priority ?? defaults.priority,
  };
}

/** The exact line Add will append — the same `buildQuickAddTaskLine` the write uses,
 * so the preview can't drift from what lands in the note. `null` while there's no
 * description yet. */
export function previewLine(result: QuickAddResult, settings: PerliteSettings, today: CalendarDate): string | null {
  if (result.description.trim().length === 0) return null;
  try {
    return serialize(buildQuickAddTaskLine(result, today, parserConfiguration(settings)));
  } catch {
    return null;
  }
}
