import { describe, expect, test } from "bun:test";
import { gitFailureDetail } from "../_test-helpers";

describe("gitFailureDetail", () => {
  test("spawn failure (status null, error set) surfaces the spawn error, not 'exit null'", () => {
    expect(
      gitFailureDetail({
        status: null,
        signal: null,
        error: new Error("spawn git ENOENT"),
        stderr: "",
      }),
    ).toBe("spawn git ENOENT");
  });

  test("non-zero exit with stderr surfaces the trimmed stderr", () => {
    expect(
      gitFailureDetail({ status: 1, signal: null, stderr: "  fatal: not a git repository\n" }),
    ).toBe("fatal: not a git repository");
  });

  test("non-zero exit with EMPTY stderr falls through to exit code (|| not ??)", () => {
    expect(gitFailureDetail({ status: 128, signal: null, stderr: "" })).toBe("exit 128");
  });

  test("signal kill (status null, no error) surfaces the signal", () => {
    expect(gitFailureDetail({ status: null, signal: "SIGKILL", stderr: "" })).toBe(
      "signal SIGKILL",
    );
  });
});
