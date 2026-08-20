import { calendarDateToISOString } from "../model/CalendarDate.js";
import type { DateValue } from "../model/DateValue.js";
import { allTags, type ParsedTask } from "../model/ParsedTask.js";
import { PRIORITY_VALUES } from "../model/Priority.js";
import type { TaskStatusKind } from "../model/TaskStatus.js";

/**
 * The dimension to group a task list by — MVP §6.7's explicit list.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Query/GroupingEngine.swift`.
 */
export type GroupKey = "dueDate" | "priority" | "tag" | "file" | "folder" | "status";

export const GROUP_KEY_VALUES: readonly GroupKey[] = ["dueDate", "priority", "tag", "file", "folder", "status"];

/** One group section. `key` is a display-ready label already in final sort order — see
 * `group` for the ordering rules per dimension. Collapsibility is a pure UI concern and
 * has no representation here. */
export interface TaskGroup {
  readonly key: string;
  readonly tasks: readonly ParsedTask[];
}

const NO_DATE = "No date";
const NO_TAGS = "No tags";
const UNKNOWN = "Unknown";

/** Every dimension pushes its "nothing to group by" bucket (`"No date"`, `"No tags"`,
 * `"Unknown"`) to the **end**, regardless of where it would otherwise sort — a
 * consistent rule across all six dimensions rather than a special case per dimension. */
export function group(tasks: readonly ParsedTask[], key: GroupKey): TaskGroup[] {
  switch (key) {
    case "dueDate":
      return groupByDueDate(tasks);
    case "priority":
      return groupByPriority(tasks);
    case "tag":
      return groupByTag(tasks);
    case "file":
      return groupBySentinelLastKey(tasks, UNKNOWN, (task) => task.location?.filePath ?? null);
    case "folder":
      return groupBySentinelLastKey(tasks, UNKNOWN, folderKey);
    case "status":
      return groupByStatus(tasks);
  }
}

function dateGroupKey(date: DateValue | null): string {
  if (date === null) return NO_DATE;
  return date.kind === "valid" ? calendarDateToISOString(date.date) : `Invalid: ${date.raw}`;
}

function groupByDueDate(tasks: readonly ParsedTask[]): TaskGroup[] {
  const buckets = new Map<string, ParsedTask[]>();
  for (const task of tasks) {
    const key = dateGroupKey(task.due);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(task);
    else buckets.set(key, [task]);
  }
  const sortedKeys = [...buckets.keys()].sort((a, b) => compareWithSentinelLast(a, b, NO_DATE));
  return sortedKeys.map((k) => ({ key: k, tasks: buckets.get(k)! }));
}

function groupByPriority(tasks: readonly ParsedTask[]): TaskGroup[] {
  // `PRIORITY_VALUES` is declared highest-to-lowest, exactly the display order wanted.
  const groups: TaskGroup[] = [];
  for (const priority of PRIORITY_VALUES) {
    const matching = tasks.filter((task) => task.priority === priority);
    if (matching.length > 0) groups.push({ key: priority, tasks: matching });
  }
  return groups;
}

/** A task with multiple tags appears in multiple groups — standard behaviour for
 * tag-based grouping in this class of app. */
function groupByTag(tasks: readonly ParsedTask[]): TaskGroup[] {
  const buckets = new Map<string, ParsedTask[]>();
  const untagged: ParsedTask[] = [];
  for (const task of tasks) {
    const tags = allTags(task);
    if (tags.length === 0) {
      untagged.push(task);
      continue;
    }
    for (const tag of tags) {
      const bucket = buckets.get(tag.raw);
      if (bucket) bucket.push(task);
      else buckets.set(tag.raw, [task]);
    }
  }
  const groups: TaskGroup[] = [...buckets.keys()].sort().map((k) => ({ key: k, tasks: buckets.get(k)! }));
  if (untagged.length > 0) groups.push({ key: NO_TAGS, tasks: untagged });
  return groups;
}

function folderKey(task: ParsedTask): string | null {
  const path = task.location?.filePath;
  if (path === null || path === undefined) return null;
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? "" : path.slice(0, lastSlash); // "" = top-level file
}

function compareWithSentinelLast(a: string, b: string, sentinel: string): number {
  if (a === sentinel) return b === sentinel ? 0 : 1;
  if (b === sentinel) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function groupBySentinelLastKey(
  tasks: readonly ParsedTask[],
  sentinel: string,
  keyFor: (task: ParsedTask) => string | null,
): TaskGroup[] {
  const buckets = new Map<string, ParsedTask[]>();
  for (const task of tasks) {
    const key = keyFor(task) ?? sentinel;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(task);
    else buckets.set(key, [task]);
  }
  const sortedKeys = [...buckets.keys()].sort((a, b) => compareWithSentinelLast(a, b, sentinel));
  return sortedKeys.map((k) => ({ key: k, tasks: buckets.get(k)! }));
}

const STATUS_GROUP_ORDER: readonly TaskStatusKind[] = ["todo", "custom", "done", "cancelled"];

function groupByStatus(tasks: readonly ParsedTask[]): TaskGroup[] {
  const groups: TaskGroup[] = [];
  for (const kind of STATUS_GROUP_ORDER) {
    const matching = tasks.filter((task) => task.status.kind === kind);
    if (matching.length > 0) groups.push({ key: kind, tasks: matching });
  }
  return groups;
}
