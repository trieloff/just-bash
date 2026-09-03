import type { IFileSystem } from "../../fs/interface.js";
import { MAX_SYMLINK_DEPTH, normalizePath } from "../../fs/path-utils.js";
import type { FileTraversalBudget } from "../../fs/traversal.js";

/**
 * How much of the path has to exist.
 *
 * - `default`: every component but the last (GNU's default)
 * - `existing`: all of it (`-e`)
 * - `missing`: none of it (`-m`)
 */
export type ExistencePolicy = "default" | "existing" | "missing";

export interface CanonicalizeOptions {
  existence: ExistencePolicy;
  /** `-s` / `--no-symlinks`: expand nothing, resolve `.` and `..` textually. */
  noSymlinks: boolean;
  /** `-L` / `--logical`: resolve `..` before symlinks instead of after. */
  logical: boolean;
}

export type CanonicalizeFailure = "ENOENT" | "ENOTDIR" | "ELOOP";

export type CanonicalizeResult =
  | { ok: true; path: string }
  | { ok: false; code: CanonicalizeFailure };

/** Path components with `.` and empty segments dropped; `..` is significant. */
function splitComponents(path: string): string[] {
  return path.split("/").filter((part) => part !== "" && part !== ".");
}

function parentOf(resolved: string): string {
  return resolved.slice(0, resolved.lastIndexOf("/"));
}

/**
 * Resolve `input` to an absolute path the way GNU `realpath` does.
 *
 * Components are walked one at a time rather than handed to `fs.realpath()`
 * so that `-e`/`-m`, `-s` and `-L` can each apply their own existence and
 * symlink policy, and so a failure can be reported with the errno GNU prints.
 */
export async function canonicalize(
  fs: IFileSystem,
  cwd: string,
  input: string,
  options: CanonicalizeOptions,
  budget: FileTraversalBudget,
): Promise<CanonicalizeResult> {
  if (input === "") {
    // GNU rejects the empty name outright, in every mode.
    return { ok: false, code: "ENOENT" };
  }

  const absolute = input.startsWith("/") ? input : `${cwd}/${input}`;
  // A trailing slash asserts the name is a directory.
  const requireDirectory = input.endsWith("/");

  if (options.noSymlinks) {
    const path = normalizePath(absolute);
    if (options.existence === "existing" && !(await fs.exists(path))) {
      return { ok: false, code: "ENOENT" };
    }
    return { ok: true, path };
  }

  // In logical mode `..` is cancelled against the written path before any
  // symlink is read, which normalizePath already does.
  const queue = splitComponents(
    options.logical ? normalizePath(absolute) : absolute,
  );
  let resolved = "";
  let index = 0;
  let symlinkHops = 0;

  while (index < queue.length) {
    const component = queue[index++];
    budget.visit(index);

    if (component === "..") {
      resolved = parentOf(resolved);
      continue;
    }

    const candidate = `${resolved}/${component}`;
    const stat = await fs.lstat(candidate).catch(() => undefined);
    const isLastComponent = index === queue.length;

    if (!stat) {
      if (
        options.existence === "existing" ||
        (options.existence === "default" && !isLastComponent)
      ) {
        return { ok: false, code: "ENOENT" };
      }
      resolved = candidate;
      continue;
    }

    if (stat.isSymbolicLink) {
      if (++symlinkHops > MAX_SYMLINK_DEPTH) {
        // `-m` promises never to fail, so a loop leaves the link unexpanded
        // instead of reporting ELOOP.
        if (options.existence === "missing") {
          resolved = candidate;
          continue;
        }
        return { ok: false, code: "ELOOP" };
      }
      const target = await fs.readlink(candidate);
      const targetComponents = splitComponents(target);
      if (target.startsWith("/")) {
        resolved = "";
      }
      // The link itself was never written to `resolved`, so a relative target
      // resolves against the directory holding it, as it should.
      queue.splice(index, 0, ...targetComponents);
      continue;
    }

    resolved = candidate;

    if (
      !stat.isDirectory &&
      options.existence !== "missing" &&
      (!isLastComponent || requireDirectory)
    ) {
      return { ok: false, code: "ENOTDIR" };
    }
  }

  return { ok: true, path: resolved === "" ? "/" : resolved };
}
