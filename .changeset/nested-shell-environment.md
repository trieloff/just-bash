---
"just-bash": patch
---

bash/sh: start nested shells from the exported environment only

`Bash.exec(…, { env, replaceEnv: true })` set its variables for commands run directly, but a nested `sh -c` or `bash -c` never saw them, and still saw the constructor's env instead:

```js
const bash = new Bash({ env: { SECRET: "leak" } });
await bash.exec("sh", {
  args: ["-c", "echo [$MARKER]; printenv SECRET"],
  env: { MARKER: "YES" },
  replaceEnv: true,
}); // was "[]\nleak\n", now "[YES]\n"
```

Nested `sh` and `bash` now inherit only exported variables. Per-exec environment values reach them, `export -n` takes effect, and exports made in one `exec()` no longer affect later calls. Wrappers such as `env`, `time`, and `timeout` use the active caller's variables and exports, preserving script exports without restoring constructor variables during replacement execution.

Startup resets `IFS` and `OPTIND` while retaining inherited export attributes. `cd -` uses the current `OLDPWD`: an unset value reports an error, and an empty value succeeds without changing directory.
