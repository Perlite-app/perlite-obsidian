import { compareCalendarDates, type CalendarDate } from "../model/CalendarDate.js";
import { dateValueCalendarDate } from "../model/DateValue.js";
import { allTags, type ParsedTask } from "../model/ParsedTask.js";
import { PRIORITY_VALUES, type Priority } from "../model/Priority.js";
import { taskTagNormalizedKey } from "../model/TaskTag.js";
import { isCompletedToday } from "./completedToday.js";
import { matchesDefaultSegment } from "./defaultSegments.js";
import { matches } from "./FilterEngine.js";
import type { SmartList } from "./SmartList.js";

/**
 * The design pass's "lens": which slice of the vault the main Perlite tab shows — the
 * plugin counterpart of the native app's `TaskLens` (chunk 57). Picked from the
 * "Perlite lenses" sidebar: the date lenses, High priority, All tasks, any smart list, a
 * tag, or a single note. Pure — no Obsidian import — so it's unit-tested directly.
 */
export type Lens =
  | { readonly kind: "today" }
  | { readonly kind: "upcoming" }
  | { readonly kind: "noDate" }
  | { readonly kind: "high" }
  | { readonly kind: "all" }
  | { readonly kind: "tag"; readonly tag: string }
  | { readonly kind: "note"; readonly path: string }
  | { readonly kind: "list"; readonly id: string };

export const DATE_LENSES: readonly Lens[] = [{ kind: "today" }, { kind: "upcoming" }, { kind: "noDate" }, { kind: "high" }, { kind: "all" }];

/** The persisted form (settings) — prefixed so a tag, a path and a list id can't collide. */
export function lensKey(lens: Lens): string {
  switch (lens.kind) {
    case "tag":
      return `tag:${lens.tag}`;
    case "note":
      return `note:${lens.path}`;
    case "list":
      return `list:${lens.id}`;
    default:
      return lens.kind;
  }
}

export function parseLensKey(key: string): Lens {
  if (key.startsWith("tag:")) return { kind: "tag", tag: key.slice(4) };
  if (key.startsWith("note:")) return { kind: "note", path: key.slice(5) };
  if (key.startsWith("list:")) return { kind: "list", id: key.slice(5) };
  if (key === "upcoming" || key === "noDate" || key === "high" || key === "all") return { kind: key };
  return { kind: "today" };
}

export function lensesEqual(a: Lens, b: Lens): boolean {
  return lensKey(a) === lensKey(b);
}

/** "Work/Reviews.md" → folder "Work/", note "Reviews". */
export function splitNotePath(path: string): { readonly folder: string; readonly note: string } {
  const slash = path.lastIndexOf("/");
  const file = slash === -1 ? path : path.slice(slash + 1);
  return { folder: slash === -1 ? "" : path.slice(0, slash + 1), note: file.replace(/\.md$/i, "") };
}

export function lensTitle(lens: Lens, smartLists: readonly SmartList[]): string {
  switch (lens.kind) {
    case "today":
      return "Today";
    case "upcoming":
      return "Upcoming";
    case "noDate":
      return "No date";
    case "high":
      return "High priority";
    case "all":
      return "All tasks";
    case "tag":
      return lens.tag;
    case "note":
      return splitNotePath(lens.path).note;
    case "list":
      return smartLists.find((list) => list.id === lens.id)?.name ?? "Today";
  }
}

export function isOpen(task: ParsedTask): boolean {
  return task.status.kind === "todo" || task.status.kind === "custom";
}

export function isOverdue(task: ParsedTask, today: CalendarDate): boolean {
  const due = dateValueCalendarDate(task.due);
  return isOpen(task) && due !== null && compareCalendarDates(due, today) < 0;
}

function hasTag(task: ParsedTask, tag: string): boolean {
  const wanted = tag.toLowerCase();
  return allTags(task).some((candidate) => taskTagNormalizedKey(candidate) === wanted);
}

/** Whether `task` shows under `lens`. Open tasks always; done tasks only where seeing
 * them means something — Today shows what was finished today (it's what the progress
 * ring counts), the narrow lenses (tag, note, All) show done ones greyed. Cancelled
 * tasks only with `includeCancelled`, on the narrow lenses. */
export function lensMatches(
  task: ParsedTask,
  lens: Lens,
  today: CalendarDate,
  smartLists: readonly SmartList[],
  options: { readonly includeCancelled?: boolean } = {},
): boolean {
  if (task.status.kind === "cancelled") {
    // The board's Cancelled column: only lenses that aren't about dates or openness
    // (a tag, a note, a smart list, All) have a meaningful cancelled set.
    const narrow = lens.kind === "tag" || lens.kind === "note" || lens.kind === "list" || lens.kind === "all";
    if (options.includeCancelled !== true || !narrow) return false;
  }
  switch (lens.kind) {
    case "today":
      return isOpen(task)
        ? matchesDefaultSegment(task, "overdue", today) || matchesDefaultSegment(task, "today", today)
        : isCompletedToday(task, today);
    case "upcoming":
      return isOpen(task) && matchesDefaultSegment(task, "upcoming", today);
    case "noDate":
      return isOpen(task) && matchesDefaultSegment(task, "noDate", today);
    case "high":
      return isOpen(task) && (task.priority === "high" || task.priority === "highest");
    case "all":
      return true;
    case "tag":
      return hasTag(task, lens.tag);
    case "note":
      return task.location?.filePath === lens.path;
    case "list": {
      const list = smartLists.find((candidate) => candidate.id === lens.id);
      return list !== undefined && matches(task, list.filter, today);
    }
  }
}

/** Overdue first, then priority, then earliest due — the order "what next" is read in,
 * both for the Up next card and within every group. Done tasks sink to the bottom. */
export function compareForAttention(a: ParsedTask, b: ParsedTask, today: CalendarDate): number {
  const openA = isOpen(a) ? 0 : 1;
  const openB = isOpen(b) ? 0 : 1;
  if (openA !== openB) return openA - openB;
  const overdueA = isOverdue(a, today) ? 0 : 1;
  const overdueB = isOverdue(b, today) ? 0 : 1;
  if (overdueA !== overdueB) return overdueA - overdueB;
  const priorityDelta = PRIORITY_VALUES.indexOf(a.priority) - PRIORITY_VALUES.indexOf(b.priority);
  if (priorityDelta !== 0) return priorityDelta;
  const dueA = dateValueCalendarDate(a.due);
  const dueB = dateValueCalendarDate(b.due);
  if (dueA !== null && dueB !== null) return compareCalendarDates(dueA, dueB);
  return dueA !== null ? -1 : dueB !== null ? 1 : 0;
}

export function upNext(tasks: readonly ParsedTask[], today: CalendarDate): ParsedTask | null {
  const open = tasks.filter(isOpen);
  if (open.length === 0) return null;
  return [...open].sort((a, b) => compareForAttention(a, b, today))[0] ?? null;
}

export type ListGrouping = "note" | "due" | "priority";

export interface ListGroup {
  readonly key: string;
  /** The folder part of a note group ("Work/"), shown muted before the name. */
  readonly prefix: string;
  readonly title: string;
  readonly tone: "normal" | "overdue" | Priority;
  readonly tasks: readonly ParsedTask[];
}

const PRIORITY_TITLE: Readonly<Record<Priority, string>> = {
  highest: "Highest",
  high: "High",
  medium: "Medium",
  normal: "No priority",
  low: "Low",
  lowest: "Lowest",
};

export function priorityTitle(priority: Priority): string {
  return PRIORITY_TITLE[priority];
}

/** The main tab's "Group by" — by note (first appearance after sorting decides note
 * order), by due bucket, or by priority. Empty groups are dropped. */
export function groupForList(tasks: readonly ParsedTask[], grouping: ListGrouping, today: CalendarDate): ListGroup[] {
  const sorted = [...tasks].sort((a, b) => compareForAttention(a, b, today));
  if (grouping === "note") {
    const order: string[] = [];
    const buckets = new Map<string, ParsedTask[]>();
    for (const task of sorted) {
      const path = task.location?.filePath ?? "";
      if (!buckets.has(path)) {
        order.push(path);
        buckets.set(path, []);
      }
      buckets.get(path)!.push(task);
    }
    return order.map((path) => {
      const { folder, note } = splitNotePath(path);
      return { key: path, prefix: folder, title: note, tone: "normal" as const, tasks: buckets.get(path)! };
    });
  }
  if (grouping === "priority") {
    return PRIORITY_VALUES.map((priority) => ({
      key: priority,
      prefix: "",
      title: PRIORITY_TITLE[priority],
      tone: priority,
      tasks: sorted.filter((task) => task.priority === priority),
    })).filter((group) => group.tasks.length > 0);
  }
  const bucket = (task: ParsedTask): string => {
    const due = dateValueCalendarDate(task.due);
    if (due === null) return "none";
    const order = compareCalendarDates(due, today);
    return order < 0 ? "over" : order === 0 ? "today" : "later";
  };
  const DUE_BUCKETS: readonly [string, string][] = [
    ["over", "Overdue"],
    ["today", "Due today"],
    ["later", "Later"],
    ["none", "No due date"],
  ];
  return DUE_BUCKETS.map(([key, title]) => ({
    key,
    prefix: "",
    title,
    tone: key === "over" ? ("overdue" as const) : ("normal" as const),
    tasks: sorted.filter((task) => bucket(task) === key),
  })).filter((group) => group.tasks.length > 0);
}

/** What a task typed into the main tab's capture field (or the Quick add modal opened
 * from it) gets when the text doesn't say otherwise — so it lands in the lens it was
 * typed on instead of vanishing from view. */
export interface LensCaptureDefaults {
  readonly dueToday: boolean;
  readonly priority: Priority | null;
  readonly tag: string | null;
  readonly destination: string | null;
}

export function lensCaptureDefaults(lens: Lens): LensCaptureDefaults {
  return {
    dueToday: lens.kind === "today",
    priority: lens.kind === "high" ? "high" : null,
    tag: lens.kind === "tag" ? lens.tag : null,
    destination: lens.kind === "note" ? lens.path : null,
  };
}
