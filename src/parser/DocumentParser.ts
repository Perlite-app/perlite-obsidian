import type { ParsedTask } from "../model/ParsedTask.js";
import { createTaskTag, type TaskTag } from "../model/TaskTag.js";
import type { TaskLocation } from "../model/TaskLocation.js";
import { DEFAULT_PARSER_CONFIGURATION, type ParserConfiguration } from "./ParserConfiguration.js";
import { parseLine } from "./TaskLineParser.js";

/**
 * File-level parsing: splits a document into lines while preserving each line's
 * terminator, skips YAML frontmatter and fenced code blocks (checkboxes inside code
 * fences must never be treated as tasks — a decision only a file-level pass can make),
 * extracts frontmatter `tags:` for inheritance, and runs the line parser over every
 * remaining line.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Parser/DocumentParser.swift` — genuinely
 * *simpler* here than in Swift for one specific reason worth recording: the Swift
 * original has to split lines on the `unicodeScalars` view specifically, because Swift's
 * `String` groups a `\r\n` pair into a single extended grapheme cluster, so scanning for
 * a bare `"\n"` `Character` silently skips over every CRLF pair. JavaScript string
 * indexing has no such grapheme-cluster merging at all — `\r` and `\n` are always two
 * separate UTF-16 code units, always independently indexable — so the plain code-unit
 * loop below needs no equivalent workaround.
 */

export type LineEnding = "\n" | "\r\n" | "";

export interface DocumentLine {
  readonly text: string;
  readonly ending: LineEnding;
}

/** The result of parsing one markdown file: every task line found, tags inherited from
 * YAML frontmatter, and enough of the original structure to reassemble the file
 * byte-for-byte via `reserializeDocument`. */
export interface ParsedDocument {
  readonly filePath: string;
  readonly tasks: readonly ParsedTask[];
  readonly frontmatterTags: readonly TaskTag[];
  readonly lines: readonly DocumentLine[];
}

/** Reassembles the document into its original text. Byte-identical to the input
 * `parseDocument` was given, since nothing here rewrites line content — only the
 * serializer's mutations do that, one line at a time. */
export function reserializeDocument(document: ParsedDocument): string {
  return document.lines.map((line) => line.text + line.ending).join("");
}

export function parseDocument(
  content: string,
  filePath: string,
  configuration: ParserConfiguration = DEFAULT_PARSER_CONFIGURATION,
): ParsedDocument {
  const lines = splitLines(content);
  const frontmatterEnd = frontmatterClosingLineIndex(lines);
  const frontmatterTags = frontmatterEnd !== null ? extractFrontmatterTags(lines, frontmatterEnd) : [];
  // Passed to every task's `inheritedTags` only when the setting is on — never inferred
  // implicitly just because frontmatter tags happen to exist.
  const inheritedTags = configuration.frontmatterTagInheritance ? frontmatterTags : [];

  const tasks: ParsedTask[] = [];
  let fence: FenceState | null = null;
  let currentHeading: string | null = null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (frontmatterEnd !== null && index <= frontmatterEnd) continue;

    const trimmed = line.text.trim();

    if (fence !== null) {
      if (isFenceClose(trimmed, fence)) {
        fence = null;
      }
      continue;
    }
    const opened = detectFenceOpen(trimmed);
    if (opened !== null) {
      fence = opened;
      continue;
    }
    // Heading state has to be tracked after fence handling, not before: a line starting
    // with `#` inside a fenced code block (a shell comment, a Python comment) is code,
    // never a heading — the same "only a file-level pass can tell" reasoning as the
    // fenced-checkbox rule.
    const heading = atxHeadingText(trimmed);
    if (heading !== null) {
      currentHeading = heading;
      continue;
    }

    const location: TaskLocation = { filePath, lineIndex: index };
    try {
      const task = parseLine(line.text, { location, configuration, inheritedTags, parentHeading: currentHeading });
      tasks.push(task);
    } catch {
      // Not a task line — expected for most lines in most files, not an error.
    }
  }

  return { filePath, tasks, frontmatterTags, lines };
}

// --- Line splitting --------------------------------------------------------------------

export function splitLines(content: string): DocumentLine[] {
  if (content.length === 0) return [];
  const lines: DocumentLine[] = [];
  const end = content.length;
  let current = 0;
  let lineStart = 0;
  while (current < end) {
    const c = content[current];
    if (c === "\n") {
      lines.push({ text: content.slice(lineStart, current), ending: "\n" });
      current += 1;
      lineStart = current;
    } else if (c === "\r") {
      const next = current + 1;
      if (next < end && content[next] === "\n") {
        lines.push({ text: content.slice(lineStart, current), ending: "\r\n" });
        current = next + 1;
        lineStart = current;
      } else {
        current += 1;
      }
    } else {
      current += 1;
    }
  }
  if (lineStart < end) {
    lines.push({ text: content.slice(lineStart, end), ending: "" });
  }
  return lines;
}

// --- Frontmatter -----------------------------------------------------------------------

function frontmatterClosingLineIndex(lines: readonly DocumentLine[]): number | null {
  const first = lines[0];
  if (first === undefined || first.text !== "---") return null;
  let i = 1;
  while (i < lines.length) {
    if (lines[i]!.text === "---") return i;
    i += 1;
  }
  return null;
}

function appendTag(value: string, tags: TaskTag[]): void {
  let trimmed = value.trim();
  // Strips *every* leading/trailing `"`/`'` character, matching Swift's
  // `trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))` — a repeated strip of
  // any character in the set from both ends, not just a single matching quote pair.
  while (trimmed.length > 0 && (trimmed[0] === '"' || trimmed[0] === "'")) {
    trimmed = trimmed.slice(1);
  }
  while (trimmed.length > 0 && (trimmed[trimmed.length - 1] === '"' || trimmed[trimmed.length - 1] === "'")) {
    trimmed = trimmed.slice(0, -1);
  }
  if (trimmed.length === 0) return;
  tags.push(createTaskTag("#" + trimmed));
}

/** Recognises `tags:` in any of the three YAML shapes Obsidian's frontmatter allows:
 * inline array (`tags: [a, b]`), a single inline value (`tags: work`), or a YAML list
 * (`tags:` followed by `- a` / `- b` lines). */
function extractFrontmatterTags(lines: readonly DocumentLine[], closingIndex: number): TaskTag[] {
  const tags: TaskTag[] = [];
  let i = 1;
  while (i < closingIndex) {
    const text = lines[i]!.text;
    if (text.startsWith("tags:")) {
      const after = text.slice("tags:".length).trim();
      if (after.startsWith("[") && after.endsWith("]")) {
        const inner = after.slice(1, -1);
        for (const part of inner.split(",")) {
          appendTag(part, tags);
        }
      } else if (after.length > 0) {
        appendTag(after, tags);
      } else {
        let j = i + 1;
        while (j < closingIndex) {
          const itemText = lines[j]!.text.trim();
          if (!itemText.startsWith("- ")) break;
          appendTag(itemText.slice(2), tags);
          j += 1;
        }
      }
    }
    i += 1;
  }
  return tags;
}

// --- Headings --------------------------------------------------------------------------

/** Recognises an ATX heading (`#` through `######`) and returns its text, or `null` if
 * `trimmed` isn't one. Setext headings (`===`/`---` underlines) are deliberately not
 * recognised — `---` collides with frontmatter delimiters and horizontal rules, and
 * that ambiguity isn't worth resolving for a rare heading form. Operates directly on
 * `trimmed`'s own UTF-16 indices throughout (no intermediate character array, unlike the
 * Swift original's `Array(trimmed)`) — safe under the same reasoning as the rest of this
 * parser: every check here is an exact-equality test against `#`, ` `, or `\t`. */
export function atxHeadingText(trimmed: string): string | null {
  if (trimmed.length === 0 || trimmed[0] !== "#") return null;
  let level = 0;
  while (level < trimmed.length && trimmed[level] === "#") {
    level += 1;
  }
  if (level > 6) return null;
  if (!(level === trimmed.length || trimmed[level] === " " || trimmed[level] === "\t")) return null;

  let start = level;
  while (start < trimmed.length && (trimmed[start] === " " || trimmed[start] === "\t")) {
    start += 1;
  }
  let end = trimmed.length;
  while (end > start && (trimmed[end - 1] === " " || trimmed[end - 1] === "\t")) {
    end -= 1;
  }

  // An optional closing "#" sequence (`## Heading ##`) — only stripped when it's
  // preceded by whitespace (or the heading is empty without it), per CommonMark.
  let closeEnd = end;
  while (closeEnd > start && trimmed[closeEnd - 1] === "#") {
    closeEnd -= 1;
  }
  if (closeEnd < end && (closeEnd === start || trimmed[closeEnd - 1] === " " || trimmed[closeEnd - 1] === "\t")) {
    end = closeEnd;
    while (end > start && (trimmed[end - 1] === " " || trimmed[end - 1] === "\t")) {
      end -= 1;
    }
  }

  return trimmed.slice(start, end);
}

// --- Fenced code blocks ------------------------------------------------------------------

interface FenceState {
  readonly char: string;
  readonly length: number;
}

function detectFenceOpen(trimmed: string): FenceState | null {
  const first = trimmed.length > 0 ? trimmed[0] : undefined;
  if (first !== "`" && first !== "~") return null;
  let length = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === first) {
      length += 1;
    } else {
      break;
    }
  }
  if (length < 3) return null;
  if (first === "`") {
    const rest = trimmed.slice(length);
    if (rest.includes("`")) return null;
  }
  return { char: first, length };
}

function isFenceClose(trimmed: string, fence: FenceState): boolean {
  if (trimmed.length === 0) return false;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] !== fence.char) return false;
  }
  return trimmed.length >= fence.length;
}
