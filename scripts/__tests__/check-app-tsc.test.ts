import { describe, expect, test } from "bun:test";
import { describeUnparseableTscFailure } from "../check-app-tsc";

// #386/1: when tsc -b ends with exit≠0 but no line matches `/ error TS\d+:/`
// (spawn errors, config loading, `error TS6053:` without a leading space),
// the runner misleadingly printed "0 error(s)" and exited 1. The helper builds
// the diagnostic that makes this path visible.
describe("describeUnparseableTscFailure", () => {
  test("spawn error (status null) → surfaces spawn error + no-output note", () => {
    const msg = describeUnparseableTscFailure(
      { status: null, error: new Error("spawn tsc ENOENT") },
      "",
    );
    expect(msg).toContain("no parseable");
    expect(msg).toContain("spawn error: spawn tsc ENOENT");
    expect(msg).toContain("exit status: null");
    expect(msg).toContain("(no stdout/stderr captured)");
  });

  test("non-zero exit with unparseable output → surfaces the raw output", () => {
    const raw = "error TS6053: File 'x.ts' not found.";
    const msg = describeUnparseableTscFailure({ status: 1 }, raw);
    expect(msg).toContain("exit status: 1");
    expect(msg).toContain("raw tsc output:");
    expect(msg).toContain(raw);
    // No spawn error hint when result.error is absent.
    expect(msg).not.toContain("spawn error");
  });
});
