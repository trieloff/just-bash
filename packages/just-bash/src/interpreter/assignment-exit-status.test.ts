import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

/**
 * `$?` after a command that has no command word.
 *
 * Bash gives a bare assignment status 0 — it does not re-report whatever ran
 * before it. The only thing that can change that is a command substitution in
 * one of the assigned values (`x=$(exit 7)` is 7); a substitution in a
 * redirection target is not one of those.
 *
 * Leaking the previous status here is invisible until something reads it. An
 * `else` branch is the sharp edge: it runs with `$?` set to 1 by the failed
 * condition, so an `else` branch ending in an assignment made the whole `if`
 * report failure, and under `set -e` that killed the script with no output.
 *
 * Every expectation here was verified against real bash before being written.
 */
describe("exit status of commands with no command word", () => {
  describe("bare assignments report success", () => {
    it("should reset $? after a plain assignment", async () => {
      const env = new Bash();
      const result = await env.exec(`false; x=1; echo "status=$?"`);
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should reset $? after multiple assignments in one command", async () => {
      const env = new Bash();
      const result = await env.exec(`false; x=1 y=2; echo "status=$?"`);
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should reset $? after an array assignment", async () => {
      const env = new Bash();
      const result = await env.exec(`false; arr=(a b); echo "status=$?"`);
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should reset $? after a subscript assignment", async () => {
      const env = new Bash();
      const result = await env.exec(`false; arr[0]=a; echo "status=$?"`);
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should reset $? after an append assignment", async () => {
      const env = new Bash();
      const result = await env.exec(`false; x+=tail; echo "status=$?"`);
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should let the assignment read $? before resetting it", async () => {
      const env = new Bash();
      const result = await env.exec(`false; x=$?; echo "x=$x status=$?"`);
      expect(result.stdout).toBe("x=1 status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should reset $? for every assignment in a row", async () => {
      const env = new Bash();
      const result = await env.exec(
        `false; x=1; echo "first=$?"; false; y=2; echo "second=$?"`,
      );
      expect(result.stdout).toBe("first=0\nsecond=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should reset $? for a bare redirection", async () => {
      const env = new Bash();
      const result = await env.exec(`false; > /tmp/out; echo "status=$?"`);
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should reset $? for a command word that expands to nothing", async () => {
      const env = new Bash();
      const result = await env.exec(`false; empty=; $empty; echo "status=$?"`);
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("command substitutions still set the status", () => {
    it("should report the status of a substitution in the value", async () => {
      const env = new Bash();
      const result = await env.exec(`false; x=$(exit 7); echo "status=$?"`);
      expect(result.stdout).toBe("status=7\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should report the last substitution when several run", async () => {
      const env = new Bash();
      const result = await env.exec(
        `false; x=$(exit 3) y=$(exit 4); echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=4\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should keep the substitution status across a later plain value", async () => {
      const env = new Bash();
      const result = await env.exec(
        `false; x=$(exit 3) y=plain; echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=3\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should report a substitution nested in a parameter expansion", async () => {
      const env = new Bash();
      const result = await env.exec(
        `false; x=\${y:=$(exit 9)}; echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=9\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should report the substitution even with a redirection attached", async () => {
      const env = new Bash();
      const result = await env.exec(
        `false; x=$(exit 7) > /tmp/out; echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=7\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should report a substitution used as the command word", async () => {
      const env = new Bash();
      const result = await env.exec(`false; $(exit 42); echo "status=$?"`);
      expect(result.stdout).toBe("status=42\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should not take the status from a process substitution", async () => {
      const env = new Bash();
      const result = await env.exec(`false; x=<(echo hi); echo "status=$?"`);
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("an else branch ending in an assignment", () => {
    it("should run the whole branch and report success", async () => {
      const env = new Bash();
      const result = await env.exec(
        `if false; then echo then; else x=1; echo "else x=$x"; fi`,
      );
      expect(result.stdout).toBe("else x=1\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should report success when the branch is a single assignment", async () => {
      const env = new Bash();
      const result = await env.exec(
        `if false; then :; else x=1; fi; echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should report success when the branch is only assignments", async () => {
      const env = new Bash();
      const result = await env.exec(
        `if false; then :; else x=1; y=2; fi; echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should report success for an assignment inside a group", async () => {
      const env = new Bash();
      const result = await env.exec(
        `if false; then :; else { x=1; }; fi; echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should not abort the script under set -e", async () => {
      const env = new Bash();
      const result = await env.exec(
        `set -e\nif false; then :; else x=1; echo reached; fi\necho done`,
      );
      expect(result.stdout).toBe("reached\ndone\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should not abort the script when the branch ends in the assignment", async () => {
      const env = new Bash();
      const result = await env.exec(
        `set -e\nif false; then :; else x=1; fi\necho done`,
      );
      expect(result.stdout).toBe("done\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("other constructs that inherit a failed status", () => {
    it("should reset $? for an assignment in a case branch", async () => {
      const env = new Bash();
      const result = await env.exec(
        `false; case q in q) x=1;; esac; echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should reset $? for an assignment in a loop body", async () => {
      const env = new Bash();
      const result = await env.exec(
        `false; for i in 1; do x=1; done; echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should make a bare return report the assignment's success", async () => {
      const env = new Bash();
      const result = await env.exec(
        `f() { false; x=1; return; }; f; echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should make a bare exit report the assignment's success", async () => {
      const env = new Bash();
      const result = await env.exec(`false; x=1; exit`);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });
});
