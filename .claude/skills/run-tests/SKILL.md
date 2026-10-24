---
name: run-tests
description: Run Story Block's tests with compact output (dot reporter), one file or a name filter while working, and read the failures. Use before pushing and whenever a change touches src/, testkit/, examples/ or tests/.
---

# Run Story Block's tests

Node 24 is what CI uses (node ≥ 22 works). No install step.

1. While working, run only the files that cover the change:
   ```sh
   node --test --test-reporter=dot tests/v2/capture.test.js tests/v2/stray-reread.test.js
   node --test --test-name-pattern="Re-read" tests/v2/stray-reread.test.js   # by test name (spec output)
   ```
   `docs/dev/*.md` lists the tests that guard each area.
2. Once, after the fix, the whole suite (same files as `npm test`, about 2,100 tests, 1.5–3 minutes):
   ```sh
   npm run test:dot
   npm run check
   git diff --check origin/main
   ```
   Run it once; do not re-run old code to show a test failed before.
3. Reading the output:
   - one `.` per passing test, `X` per failure; no totals are printed. The exit code is the verdict
     (`echo $?`: 0 green).
   - after the dots, `Failed tests:` lists each failure with its name, the assertion message and a stack
     whose first `file:///…` line is the test file and line.
   - a line starting `⚠` is a failing `test.todo` (a known open problem, named after what should happen); it
     prints `X` but does not fail the run (exit 0).
   - a skipped test prints `.` like a pass. To see skips, totals or every test name, run the file with
     the default reporter:
     `node --test tests/v2/capture.test.js` (prints `ℹ tests / pass / fail / skipped`).
4. Suite tests that need the other three repos as siblings (`tests/v2/break/helpers/suite*.js`,
   `tests/v2/packs/terms.test.js`, `holidays-world.test.js`) skip without them; CI skips them too.
   Use the `suite-check` skill to run them.
5. If a failure is in a test you did not touch, read the test's header comment first: break tests
   (`tests/v2/break/<id>-*.test.js`) are named after a finding in the suite notes' V2_LOG.md.
