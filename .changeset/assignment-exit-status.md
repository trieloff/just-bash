---
"just-bash": patch
---

interpreter: give a bare assignment exit status 0 instead of the previous command's

A command with no command word — `x=1`, `arr=(a b)`, `> file`, a `$empty` that expands to nothing — reported whatever `$?` already held rather than success. Bash gives such a command status 0 unless a command substitution in an assigned value set the status.

The leak is invisible until something reads `$?`, and an `else` branch is where it bites: the branch runs with `$?` set to 1 by the condition that just failed, so an `else` branch ending in an assignment made the whole `if` report failure. Under `set -e` that ended the script with no output and no diagnostic:

```bash
set -e
if false; then :; else x=1; fi
echo done                          # never ran
```

A command substitution still sets the status where bash says it does: `x=$(exit 7)` is 7, the last substitution wins across several assignments, and one nested in `${y:=$(...)}` counts. A substitution in a redirection target does not, and neither does a process substitution.
