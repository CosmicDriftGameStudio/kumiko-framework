// dirRunFailed — the exit-code decision for one integration-test directory
// run. Regression: a non-zero exit with 0 pass AND 0 fail (import-time
// crash / DB-setup failure that still prints a benign "Ran 0 tests" summary)
// was silently swallowed as a passed teardown warning (silent-skip pattern).

import { describe, expect, test } from "bun:test";
import { dirRunFailed } from "../run-integration-tests";

describe("dirRunFailed", () => {
  test("clean exit is never a failure, regardless of totals", () => {
    expect(dirRunFailed(0, { pass: 5, fail: 0, tests: 5, files: 1 })).toBe(false);
    expect(dirRunFailed(0, { pass: 0, fail: 0, tests: 0, files: 0 })).toBe(false);
  });

  test("non-zero exit with real test failures is a failure", () => {
    expect(dirRunFailed(1, { pass: 3, fail: 2, tests: 5, files: 1 })).toBe(true);
  });

  test("non-zero exit with 0 pass and 0 fail (crash-on-import) is a failure", () => {
    expect(dirRunFailed(1, { pass: 0, fail: 0, tests: 0, files: 1 })).toBe(true);
  });

  test("non-zero exit with pass > 0 and 0 fail (teardown-only error) is NOT a failure", () => {
    expect(dirRunFailed(1, { pass: 5, fail: 0, tests: 5, files: 1 })).toBe(false);
  });
});
