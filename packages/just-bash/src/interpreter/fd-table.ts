/**
 * File Descriptor Table
 *
 * One typed view over `ctx.state.fileDescriptors`, the shell's descriptor
 * table. The table itself stays a `Map<number, string>` because it is part
 * of the public `CommandContext` surface; this module owns the string
 * encoding so that no other file has to know about the `__file__:` /
 * `__rw__:` / `__dupout__:` prefixes.
 *
 * Entry kinds:
 * - `input`      readable content (`N< file`, `N<<EOF`, `N<<<word`). Reading
 *                is destructive: the remaining content is written back, so
 *                successive `read -u N` calls advance a shared position.
 * - `output`     a file opened for writing (`N> file`, `N>> file`).
 * - `readwrite`  `N<> file` — content plus an explicit read position.
 * - `dup-out`    fd duplicated from stdout/stderr (`N>&1`).
 * - `dup-in`     fd duplicated from stdin (`N<&0`).
 *
 * Note on ambiguity (pre-existing): an `input` entry is stored verbatim, so
 * content that literally begins with one of the marker prefixes decodes as
 * that other kind. The public API documents fd values as "content", so the
 * encoding is kept as-is rather than re-tagged.
 */

import { checkFdLimit } from "./helpers/result.js";
import type { InterpreterContext } from "./types.js";

const FILE_PREFIX = "__file__:";
const FILE_APPEND_PREFIX = "__file_append__:";
const RW_PREFIX = "__rw__:";
const DUP_OUT_PREFIX = "__dupout__:";
const DUP_IN_PREFIX = "__dupin__:";

/** Lowest descriptor a script may open by number. 0/1/2 are the std streams. */
export const FIRST_USER_FD = 3;

export type FdEntry =
  | { kind: "input"; content: string }
  | { kind: "output"; path: string; append: boolean }
  | { kind: "readwrite"; path: string; position: number; content: string }
  | { kind: "dup-out"; sourceFd: number }
  | { kind: "dup-in"; sourceFd: number };

/**
 * Parse the content of a read-write file descriptor.
 * Format: __rw__:pathLength:path:position:content
 * The explicit path length keeps paths containing colons parseable.
 */
function parseReadWrite(
  raw: string,
): { path: string; position: number; content: string } | null {
  const afterPrefix = raw.slice(RW_PREFIX.length);
  const firstColonIdx = afterPrefix.indexOf(":");
  if (firstColonIdx === -1) return null;
  const pathLength = Number.parseInt(afterPrefix.slice(0, firstColonIdx), 10);
  if (Number.isNaN(pathLength) || pathLength < 0) return null;
  const pathStart = firstColonIdx + 1;
  const path = afterPrefix.slice(pathStart, pathStart + pathLength);
  const remaining = afterPrefix.slice(pathStart + pathLength + 1);
  const posColonIdx = remaining.indexOf(":");
  if (posColonIdx === -1) return null;
  const position = Number.parseInt(remaining.slice(0, posColonIdx), 10);
  if (Number.isNaN(position) || position < 0) return null;
  return { path, position, content: remaining.slice(posColonIdx + 1) };
}

function parseDupSource(raw: string, prefix: string): number | null {
  const sourceFd = Number.parseInt(raw.slice(prefix.length), 10);
  return Number.isNaN(sourceFd) ? null : sourceFd;
}

/** Decode a raw table value into a typed entry. */
export function decodeFdEntry(raw: string): FdEntry {
  if (raw.startsWith(FILE_PREFIX)) {
    return {
      kind: "output",
      path: raw.slice(FILE_PREFIX.length),
      append: false,
    };
  }
  if (raw.startsWith(FILE_APPEND_PREFIX)) {
    return {
      kind: "output",
      path: raw.slice(FILE_APPEND_PREFIX.length),
      append: true,
    };
  }
  if (raw.startsWith(RW_PREFIX)) {
    const parsed = parseReadWrite(raw);
    if (parsed) return { kind: "readwrite", ...parsed };
  }
  if (raw.startsWith(DUP_OUT_PREFIX)) {
    const sourceFd = parseDupSource(raw, DUP_OUT_PREFIX);
    if (sourceFd !== null) return { kind: "dup-out", sourceFd };
  }
  if (raw.startsWith(DUP_IN_PREFIX)) {
    const sourceFd = parseDupSource(raw, DUP_IN_PREFIX);
    if (sourceFd !== null) return { kind: "dup-in", sourceFd };
  }
  return { kind: "input", content: raw };
}

/** Encode a typed entry back into its raw table value. */
export function encodeFdEntry(entry: FdEntry): string {
  switch (entry.kind) {
    case "input":
      return entry.content;
    case "output":
      return `${entry.append ? FILE_APPEND_PREFIX : FILE_PREFIX}${entry.path}`;
    case "readwrite":
      return `${RW_PREFIX}${entry.path.length}:${entry.path}:${entry.position}:${entry.content}`;
    case "dup-out":
      return `${DUP_OUT_PREFIX}${entry.sourceFd}`;
    case "dup-in":
      return `${DUP_IN_PREFIX}${entry.sourceFd}`;
  }
}

function table(ctx: InterpreterContext): Map<number, string> {
  ctx.state.fileDescriptors ??= new Map();
  return ctx.state.fileDescriptors;
}

/** Raw table value for `fd`, or undefined when the fd is not open. */
export function getRawFd(
  ctx: InterpreterContext,
  fd: number,
): string | undefined {
  return ctx.state.fileDescriptors?.get(fd);
}

/** Typed entry for `fd`, or undefined when the fd is not open. */
export function getFdEntry(
  ctx: InterpreterContext,
  fd: number,
): FdEntry | undefined {
  const raw = getRawFd(ctx, fd);
  return raw === undefined ? undefined : decodeFdEntry(raw);
}

export function isFdOpen(ctx: InterpreterContext, fd: number): boolean {
  return ctx.state.fileDescriptors?.has(fd) === true;
}

/** Store a raw value, charging the descriptor limit for newly opened fds. */
export function setRawFd(
  ctx: InterpreterContext,
  fd: number,
  raw: string,
): void {
  const fds = table(ctx);
  if (!fds.has(fd)) checkFdLimit(ctx);
  fds.set(fd, raw);
}

export function setFdEntry(
  ctx: InterpreterContext,
  fd: number,
  entry: FdEntry,
): void {
  setRawFd(ctx, fd, encodeFdEntry(entry));
}

export function closeFd(ctx: InterpreterContext, fd: number): void {
  ctx.state.fileDescriptors?.delete(fd);
}

/**
 * Readable bytes remaining on `fd`.
 * Returns a reason instead of content when the fd cannot be read from, so
 * callers can pick the diagnostic bash uses for their context.
 */
export function readFd(
  ctx: InterpreterContext,
  fd: number,
): { content: string } | { error: "not-open" | "write-only" } {
  const entry = getFdEntry(ctx, fd);
  if (entry === undefined) return { error: "not-open" };
  switch (entry.kind) {
    case "input":
      return { content: entry.content };
    case "readwrite":
      return { content: entry.content.slice(entry.position) };
    case "output":
    case "dup-out":
      return { error: "write-only" };
    case "dup-in":
      return { error: "not-open" };
  }
}

/**
 * Advance the read position of `fd` by `count` characters.
 * `input` entries keep only the unread remainder, matching bash's single
 * shared file offset: every later read continues where this one stopped.
 */
export function advanceFd(
  ctx: InterpreterContext,
  fd: number,
  count: number,
): void {
  const entry = getFdEntry(ctx, fd);
  if (entry === undefined) return;
  if (entry.kind === "input") {
    setFdEntry(ctx, fd, {
      kind: "input",
      content: entry.content.slice(count),
    });
    return;
  }
  if (entry.kind === "readwrite") {
    setFdEntry(ctx, fd, { ...entry, position: entry.position + count });
  }
}

/**
 * Snapshot the given descriptors so a scoped redirection can put the table
 * back the way it found it. `undefined` records "was not open".
 */
export function snapshotFds(
  ctx: InterpreterContext,
  fds: Iterable<number>,
): Map<number, string | undefined> {
  const snapshot = new Map<number, string | undefined>();
  for (const fd of fds) {
    if (!snapshot.has(fd)) snapshot.set(fd, getRawFd(ctx, fd));
  }
  return snapshot;
}

/** Undo the descriptor changes recorded by {@link snapshotFds}. */
export function restoreFds(
  ctx: InterpreterContext,
  snapshot: Map<number, string | undefined>,
): void {
  const fds = ctx.state.fileDescriptors;
  if (!fds) return;
  for (const [fd, raw] of snapshot) {
    if (raw === undefined) fds.delete(fd);
    else fds.set(fd, raw);
  }
}
