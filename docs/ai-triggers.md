# When an AI agent must use which Meerkat skill or tool

Read this table to decide. Each row: the name, the situations it must be used for, and the one-line reason. The skill and tool descriptions themselves are short on purpose (skills at most 200 characters, tools at most 160); the situations are written out here in full.

| Name | Use it when | Why |
|---|---|---|
| skill meerkat | starting on a project; unsure which check fits; need commands, exit codes, presets | the overview and index of the other skills |
| skill meerkat-before-commit | about to commit or git add; about to say a change is ready | the gate on changed files catches problems before they enter history |
| skill meerkat-before-pr | about to open or update a PR; about to git push; posting a PR body, comment, issue or release notes | full gate plus secrets scan, and the PR summary comes from the run |
| skill meerkat-blast-before-edit | changing, renaming, moving or deleting a symbol or file; refactoring code with callers | shows every importer and test before you break one |
| skill meerkat-click-through | built or changed a web or desktop screen; about to say the UI works | proves each page opens and each button does something (guide PLANNED) |
| skill meerkat-docs-check | README, doc or changelog changed; writing docs; feature, flag, env var or path added, renamed or removed; before a release | the words must match the code |
| skill meerkat-map-unfamiliar-code | new codebase; asked to read or explain code; planning a refactor or feature | read entry points and most imported files first |
| skill meerkat-secrets-before-post | posting, uploading, pasting or sharing text, a log, a file or a repo outside this machine; pasting a secret; an AI prompt | nothing leaves until the secrets and personal-data checks are clean |
| skill meerkat-smoke-and-red | Meerkat itself seems broken; a result looks wrong or empty; testing against broken inputs | separates tool health (smoke) from deliberate breakage (red) |
| meerkat_run | full preset run; thorough check before a release; nightly style run | runs the project's own commands, takes minutes |
| meerkat_gate | before a commit (staged); before a PR (base); only changed files matter | fast, covers only the changed files |
| meerkat_summary | need a pass or fail verdict in a few lines | short answer for chat |
| meerkat_first_failure | want just the first blocking problem; fixing one thing at a time | one line, cheapest answer |
| meerkat_last | a run finished; need failures and log ends; polling a background run | the report of a run |
| meerkat_findings | a run has findings; need worst first; CI gate with failOn | the list to work through |
| meerkat_finding | need one finding's evidence, log and fix hint | detail for one id |
| meerkat_why | one check failed; need its log tail | smallest way to see why |
| meerkat_run_list | need a run id; want to know if a project is run regularly | find runs |
| meerkat_trend | asking if the project is getting better or worse | history at a glance |
| meerkat_suggest | want a starting fix per kind of finding | commands to try, nothing is run |
| meerkat_prompt | handing a run's findings to another AI | one markdown file, WRITES |
| meerkat_pr_comment | writing a PR comment from a run | markdown only, posts nothing |
| meerkat_dismiss | the person agreed a finding is a false alarm | WRITES a dismissal with a reason |
| meerkat_undismiss | a dismissal was wrong; the reason no longer holds | WRITES, restores the finding |
| meerkat_dismissals | before dismissing; a rule keeps being dismissed | see what is already accepted |
| meerkat_baseline | the person asks to adopt a legacy project | WRITES, only new findings fail afterwards |
| meerkat_brief | before editing a file or file#symbol | callers, tests, churn and risk in one short brief |
| meerkat_blast | before changing, moving or deleting something with callers; a file you do not know well | what could break |
| meerkat_map | starting in unfamiliar code; planning a refactor | builds the code map |
| meerkat_list | want to see which checks would run | lists checks, runs none |
| meerkat_check_list | need the project's own checks and check packs | what is enabled |
| meerkat_presets | choosing a preset for meerkat_run | names, tiers, kinds |
| meerkat_discover | before picking a preset; learning the project's own tests | what full, thorough and release would run |
| meerkat_recommend | looking for coverage gaps | tests no check covers yet |
| meerkat_tests | which test kinds Meerkat has and what each proves | the catalog |
| meerkat_doctor | a check could not run; first run in a new project | missing outside tools and how to install |
| meerkat_tools | a check is skipped for a missing linter or scanner | found or missing tools, nothing installed |
| meerkat_smoke | a check seems stuck or broken | proves each check starts and stops |
| meerkat_self_test | doubting that a check can fail at all | runs each check on a broken sample |
| meerkat_redtest | changing Meerkat; doubting a check | attack tests: mutation, faults, adversarial, regression, cleantwin |
| meerkat_hook | the person asks for a pre-push check | WRITES the pre-push hook |
| meerkat_hook_status | before meerkat_hook | see what is installed |
| meerkat_describe | before telling a person which command to run | exact commands, options, exit codes |
| meerkat_version | need server version or tool count | identity of the server |

Not covered by any skill or tool: scanning text for secrets without a diff (use `meerkat` on the exact file or `meerkat_gate` with the file staged); writing release notes; changing a project's own check configuration.
