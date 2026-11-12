# Wiring the run store into another scanner

This is how Meerkat writes a run folder that survives a crash, so another scanner (the NeuralVault guard, for example) can reuse it. Source: `lib/runlog.mjs` in the Meerkat repo. Every name below is exported from that module.

## The folder

A run folder is `<log root>/runs/<stamp>-<tier>` and holds:

- `summary.json`: the machine-readable result (sealed when the run ends).
- `timeline.jsonl`: one line per start and end, in order, with time from the start of the run. Written as the run goes, so a crash leaves it.
- `report.md`: the person-readable report (written when the run ends).
- `<check>.log`: one per check, with the command, exit code, time and full output.

The log root is `MEERKAT_LOG_DIR`, else `~/.meerkat/logs`. When that folder cannot be written, `logRoot` falls back to a per-user folder in the OS temp folder and `logFallback` says so.

## Functions, in the order a scanner calls them

1. `logRoot(env, home)` returns the folder to write into (with the fallback applied).
2. `makeRunDir(env, tier, now, home, appDir, label)` creates the run folder and returns its path. Call it once per scan, before the first check.
3. `createRecorder(now)` returns a recorder. Call `record.start(name)` and `record.end(name, result)` around each unit of work; each call appends to `timeline.jsonl` right away, so a crash keeps the events so far.
4. `saveCheckLog(dir, id, text)` writes one unit's full output, and `checkLogText({...})` builds the text.
5. `sealRunDir(dir, {tier, preset, summary, exitCode, status, appDir, argv, startedAt})` writes `summary.json` when the scan ends, normally or on interrupt (`status` says which).
6. `writeRunReport({...})` writes `report.md`; `runLogText({...})` builds the text.
7. `appendRunLog(dir, text)` appends a line to a log file in the run folder.
8. `latestRunDirOfPreset(env, preset)` and `pickRunDir(env, {run, preset, folder})` find a run again later (what `meerkat last` uses).

## Crash safety

Write `timeline.jsonl` as you go and seal `summary.json` only at the end. A crash then leaves a folder with a timeline and no summary; `isSealed`-style checks (look for `summary.json`) tell a later reader the run did not finish. `runState({results, exitCode, findingsTotal})` gives the state text for an unfinished run.

## Tests to copy

`tests/runlog-*.test.ts` and `tests/log-fallback.test.ts` in the Meerkat repo show how to call each function on a temp folder, including the unwritable-folder case.
