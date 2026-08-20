/**
 * Where a task line came from, for diagnostics and "open in Obsidian" only. `lineIndex`
 * must never be used to address a write — the write-safety layer (Wave 1 chunk 7)
 * requires re-locating the target task by content match immediately before writing,
 * since sync may have replaced the file between read and write.
 *
 * 1:1 port of `PerliteCore/Sources/PerliteCore/Model/TaskLocation.swift`.
 */
export interface TaskLocation {
  readonly filePath: string;
  readonly lineIndex: number;
}
