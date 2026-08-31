/**
 * Exit-status bookkeeping for command substitutions.
 */

import type { InterpreterState } from "../types.js";

/**
 * Record the exit status of a command substitution.
 *
 * `$?` and the "a substitution ran here" marker have to move together: a
 * command with no command word (`x=1`, `> file`, an expansion that came out
 * empty) reports the status of the last substitution that ran inside it, and
 * 0 when none did. Setting `lastExitCode` without the marker leaves such a
 * command reporting the *previous* command's status instead.
 */
export function recordSubstitutionExit(
  state: InterpreterState,
  exitCode: number,
): void {
  state.lastExitCode = exitCode;
  state.env.set("?", String(exitCode));
  state.lastSubstitutionExitCode = exitCode;
}
