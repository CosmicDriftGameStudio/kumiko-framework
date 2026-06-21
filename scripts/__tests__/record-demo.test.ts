// Pure-logic tests for scripts/record-demo.ts. The rest of the file (tmux
// session control, chromium headed launch, ffmpeg avfoundation capture,
// osascript window positioning) needs an actual Mac display and is exercised
// by the recording session itself — no point mocking it.

import { describe, expect, test } from "bun:test";
import { parseArgs, resolveDemoByPrefix } from "../record-demo";

describe("parseArgs", () => {
  test("defaults to 01-create-app, not dry-run", () => {
    const args = parseArgs([]);
    expect(args.demo).toBe("01-create-app");
    expect(args.dryRun).toBe(false);
  });

  test("--dry-run flips the flag", () => {
    expect(parseArgs(["--dry-run"]).dryRun).toBe(true);
  });

  test("--demo=01 expands to the matching file prefix", () => {
    expect(parseArgs(["--demo=01"]).demo).toBe("01-create-app");
  });

  test("--demo=<full-name> is taken verbatim", () => {
    expect(parseArgs(["--demo=99-handwritten"]).demo).toBe("99-handwritten");
  });
});

describe("resolveDemoByPrefix", () => {
  test("returns the only file matching the numeric prefix", () => {
    expect(resolveDemoByPrefix("01")).toBe("01-create-app");
  });

  test("throws when no demo file matches", () => {
    expect(() => resolveDemoByPrefix("99")).toThrow(/No demo file with prefix/);
  });
});
