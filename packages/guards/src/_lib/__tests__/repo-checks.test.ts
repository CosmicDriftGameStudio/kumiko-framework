import { describe, expect, test } from "bun:test";
import type { RepoCheck, RepoCheckOutcome } from "../guard-kit";
import { reportResults, runRepoChecks } from "../guard-kit";

function checkReturning(outcome: RepoCheckOutcome, name = "check"): RepoCheck {
  return { name, run: () => outcome };
}

function captureConsole(fn: () => void): string {
  const lines: string[] = [];
  const { log, error } = console;
  const collect = (...parts: unknown[]) => {
    lines.push(parts.map(String).join(" "));
  };
  console.log = collect;
  console.error = collect;
  try {
    fn();
  } finally {
    console.log = log;
    console.error = error;
  }
  return lines.join("\n");
}

describe("runRepoChecks — the five verdicts", () => {
  test("a violation fails the check", async () => {
    const [result] = await runRepoChecks(
      [
        checkReturning({
          violations: [{ file: "a.ts", line: 1, message: "nope" }],
          matchedFiles: 1,
          notApplicable: false,
        }),
      ],
      [],
    );
    expect(result?.ok).toBe(false);
    expect(result?.outcome?.violations).toHaveLength(1);
  });

  test("warnings-only (no violations) stays ok", async () => {
    const [result] = await runRepoChecks(
      [
        checkReturning({
          violations: [],
          warnings: [{ file: "a.ts", line: 1, message: "hmm" }],
          matchedFiles: 1,
          notApplicable: false,
        }),
      ],
      [],
    );
    expect(result?.ok).toBe(true);
    expect(result?.warnings).toHaveLength(1);
  });

  test("vacuous (0 matched files despite being applicable) fails, with the generic message", async () => {
    const [result] = await runRepoChecks(
      [checkReturning({ violations: [], matchedFiles: 0, notApplicable: false })],
      [],
    );
    expect(result?.ok).toBe(false);
    expect(result?.message).toContain("0 Dateien gescannt");
  });

  test("notApplicable (target repo not in this checkout) stays ok, even with 0 matched files", async () => {
    const [result] = await runRepoChecks(
      [checkReturning({ violations: [], matchedFiles: 0, notApplicable: true })],
      [],
    );
    expect(result?.ok).toBe(true);
    expect(result?.notApplicable).toBe(true);
  });

  test("a thrown error fails closed, with sibling checks unaffected", async () => {
    const throwing: RepoCheck = {
      name: "throwing-check",
      run: () => {
        throw new Error("boom");
      },
    };
    const ok = checkReturning(
      { violations: [], matchedFiles: 1, notApplicable: false },
      "ok-check",
    );
    const results = await runRepoChecks([throwing, ok], []);
    const thrown = results.find((r) => r.name === "throwing-check");
    const okResult = results.find((r) => r.name === "ok-check");
    expect(thrown?.ok).toBe(false);
    expect(thrown?.error).toContain("boom");
    expect(okResult?.ok).toBe(true);
  });
});

describe("reportResults — warnings print without failing the run", () => {
  test("a passing check's warnings are printed after the ✓ line", () => {
    const output = captureConsole(() => {
      reportResults([
        {
          name: "warn-check",
          ok: true,
          ms: 1,
          matchedFiles: 1,
          warnings: [{ file: "a.ts", line: 3, message: "unmarked thin wrapper" }],
        },
      ]);
    });
    expect(output).toContain("✓ warn-check");
    expect(output).toContain("! a.ts:3  unmarked thin wrapper");
  });

  test("a failing check's warnings print after its violations", () => {
    const output = captureConsole(() => {
      reportResults([
        {
          name: "fail-check",
          ok: false,
          ms: 1,
          outcome: { violations: [{ file: "a.ts", line: 1, message: "blocked" }] },
          warnings: [{ file: "b.ts", line: 2, message: "also noted" }],
        },
      ]);
    });
    const violationIdx = output.indexOf("a.ts:1  blocked");
    const warningIdx = output.indexOf("! b.ts:2  also noted");
    expect(violationIdx).toBeGreaterThan(-1);
    expect(warningIdx).toBeGreaterThan(violationIdx);
  });
});
