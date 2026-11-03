## Planted-bug accuracy

Meerkat is tested against a corpus of 1540 deliberately planted defects. In the final run before 0.4.0, 1533 (99.5%) were detected by a check (the check's own verdict) and 1532 (99.5%) appear in the findings file; by impact, critical 484 of 484, high 465 of 466, medium 349 of 352, low 235 of 238; by difficulty to find, easy 1021 of 1021, medium 323 of 324, hard 118 of 120, extreme 71 of 75.

That run also scanned clean and trap twins (the same code written safely) and reported 601 false alarms across 166 twins. The run was made before the test-quality fix and the later guard changes, so 601 is not the current rate, and the final rate was not re-measured because the corpus was not run again for this release.

Recall on planted bugs measures what was planted, not real-world accuracy.

Every planted defect and its result is listed in [docs/accuracy-results.md](docs/accuracy-results.md).
