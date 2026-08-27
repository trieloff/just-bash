import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import type { DirentEntry, FsStat } from "../../fs/interface.js";

/**
 * A backend whose `readdir()` reports far more children than the directory
 * actually holds. Stands in for a host-provided `IFileSystem` that fronts a
 * directory too large to materialize, which `ls` must refuse before it sorts,
 * stats, classifies or formats the entries.
 */
class HugeDirectoryFs extends InMemoryFs {
  /** Paths under /large that were statted, i.e. per-entry work that ran. */
  readonly childStats: string[] = [];

  constructor(private readonly entryCount: number) {
    super({ "/large/.keep": "" });
  }

  private syntheticEntries(): string[] {
    const entries: string[] = [];
    for (let i = 0; i < this.entryCount; i++) entries.push(`f${i}`);
    return entries;
  }

  private recordChildAccess(path: string): void {
    const resolved = this.resolvePath("/", path);
    if (resolved.startsWith("/large/")) this.childStats.push(resolved);
  }

  override async readdir(path: string): Promise<string[]> {
    if (this.resolvePath("/", path) === "/large") {
      return this.syntheticEntries();
    }
    return super.readdir(path);
  }

  override async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    if (this.resolvePath("/", path) === "/large") {
      return this.syntheticEntries().map((name) => ({
        name,
        isFile: true,
        isDirectory: false,
        isSymbolicLink: false,
      }));
    }
    return super.readdirWithFileTypes(path);
  }

  override async stat(path: string): Promise<FsStat> {
    this.recordChildAccess(path);
    return super.stat(path);
  }

  override async lstat(path: string): Promise<FsStat> {
    this.recordChildAccess(path);
    return super.lstat(path);
  }
}

const LIMIT = 8;
const ENTRIES = 64;

function hugeDirBash(limits: {
  maxArrayElements?: number;
  maxTraversalEntries?: number;
}): { bash: Bash; fs: HugeDirectoryFs } {
  const fs = new HugeDirectoryFs(ENTRIES);
  return {
    bash: new Bash({ fs, cwd: "/", executionLimits: limits }),
    fs,
  };
}

describe("ls directory collection limits", () => {
  const commands = [
    "ls /large",
    "ls -l /large",
    "ls -F /large",
    "ls -S /large",
    "ls -R /large",
    "ls -a /large",
    "ls -l /large | head -1",
  ];

  it.each(
    commands,
  )("rejects an oversized directory result for `%s`", async (command) => {
    const { bash } = hugeDirBash({ maxArrayElements: LIMIT });
    const result = await bash.exec(command);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `bash: ls: array element limit exceeded (${LIMIT})\n`,
    );
    expect(result.exitCode).toBe(126);
  });

  it.each(
    commands,
  )("charges the traversal entry budget for `%s`", async (command) => {
    const { bash } = hugeDirBash({ maxTraversalEntries: LIMIT });
    const result = await bash.exec(command);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `bash: ls: filesystem traversal entry limit exceeded (${LIMIT})\n`,
    );
    expect(result.exitCode).toBe(126);
  });

  it("fails before any per-entry stat or classify work runs", async () => {
    const { bash, fs } = hugeDirBash({ maxArrayElements: LIMIT });
    const result = await bash.exec("ls -lF /large");
    expect(result.exitCode).toBe(126);
    expect(fs.childStats).toEqual([]);
  });

  it("bounds a directory reached through shell pathname expansion", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < ENTRIES; i++) files[`/large/f${i}`] = "";
    const bash = new Bash({
      files,
      cwd: "/",
      executionLimits: { maxArrayElements: LIMIT },
    });
    // The shell expands the pattern and hands `ls` the directory operand.
    const result = await bash.exec("ls /larg*");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `bash: ls: array element limit exceeded (${LIMIT})\n`,
    );
    expect(result.exitCode).toBe(126);
  });

  it("still lists a directory that fits inside the limits", async () => {
    const fs = new HugeDirectoryFs(3);
    const bash = new Bash({
      fs,
      cwd: "/",
      executionLimits: { maxArrayElements: LIMIT, maxTraversalEntries: LIMIT },
    });
    const result = await bash.exec("ls /large");
    expect(result.stdout).toBe("f0\nf1\nf2\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
