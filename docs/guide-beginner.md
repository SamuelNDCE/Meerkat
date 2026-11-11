# Guide for someone new to coding with AI

You are asking an AI assistant to write code. Meerkat is the safety net beside it. It reads your project, tells you in plain words what is wrong, and gives one next step for each problem. You do not need to know how the checks work.

## How to start a task

1. Open a terminal in your project folder. (A terminal is the text window where you type commands.)
2. Work on a branch, not on `main`. (A branch is your own copy of the work, so a mistake never touches the real thing.) Ask the assistant: "make a new branch for this task".
3. Ask for one small thing at a time. "Add a login button" is good. "Rebuild the whole app" is not.
4. Run `meerkat guide`. It prints the working rules and tells you which ones this change breaks. Every line starts with a rule id such as `g-small-change`. To read the full rule, type `meerkat guide --explain g-small-change`.

## When to run `meerkat verdict`

Run it after the assistant says it is done, and again after every change the assistant makes after that. A result is only true for the code as it was when the check ran.

```
meerkat verdict
```

Read the first line. That is the answer.

## What each status means

| Status | In one sentence | What to do |
| --- | --- | --- |
| PASS | The checks found nothing wrong in the files you changed. | You can go on; ask the assistant to commit. |
| FAIL | At least one check found a real problem in your changes. | Copy the line to the assistant and say "fix this", then run the verdict again. |
| NO-RESULT | Meerkat could not give an answer, for example the base branch is too far ahead. | Read the reason and the `next:` command on the same line and run that. It is not a pass. |
| STALE | The branch changed while Meerkat was checking, so the answer may be out of date. | Run the verdict again. It is not a pass. |
| INCOMPLETE | Some checks did not finish. | Run the `--resume` command it prints, or run it again. It is not a pass. |

The rule of thumb: only PASS means go. Everything else means read one line and do one thing.

## The guidelines are advice, not a gate

`meerkat guide` shows ADVISORY, PASS or NOT CHECKED for each rule. An ADVISORY line is a suggestion with a reason and a NEXT line. It never makes a verdict fail. NOT CHECKED means the rule did not apply, and the reason is on the line.

## The four rules to follow

1. **Small steps.** One task, one branch, a handful of files. If the assistant touches dozens of files, ask it to split the work.
2. **A test with every change.** If the assistant changes how something works, it adds or updates a test (a small program that checks the code does what it should).
3. **Never paste a secret.** A password, token or key typed into a file stays in the history forever. Use an environment variable (a setting stored outside the code).
4. **Check before you believe.** Run `meerkat verdict` after the last edit and read the first line before you say the work is finished.

## If you are stuck

- `meerkat help` lists every command.
- `meerkat why <check>` shows the full log of one check that failed.
- `meerkat guide --explain <id>` explains one rule.
