import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluateSecurity,
  parseAuditReport,
  type RawAuditReport,
  type SecurityException,
} from "../_lib/security-audit";
import {
  EXPIRY_BLOCK_DAYS,
  findLockfileDir,
  loadSecurityExceptions,
  runSecurityCheck,
} from "../check-security";

const NOW = Date.parse("2026-10-16T12:00:00Z");

function report(severity: string, pkg = "left-pad", ghsa = "GHSA-aaaa-bbbb-cccc"): RawAuditReport {
  return {
    [pkg]: [{ id: 1, url: `https://github.com/advisories/${ghsa}`, title: "t", severity }],
  };
}

function securityException(overrides: Partial<SecurityException>): SecurityException {
  return {
    advisory: "GHSA-aaaa-bbbb-cccc",
    package: "left-pad",
    reason: "no fix yet",
    reviewedBy: "Reviewer",
    expires: "2026-12-31",
    source: { file: "/repo/dependency-security-exceptions.json", origin: "repo" },
    ...overrides,
  };
}

const tempDirs: string[] = [];
function repoWithLockfile(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "check-security-")));
  tempDirs.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "repo" }), "utf-8");
  writeFileSync(join(dir, "bun.lock"), "{}", "utf-8");
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("parseAuditReport", () => {
  test("extracts package, severity and the GHSA id from the advisory url", () => {
    expect(parseAuditReport(report("high"))).toEqual([
      {
        package: "left-pad",
        severity: "high",
        advisoryId: "GHSA-AAAA-BBBB-CCCC",
        url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
        title: "t",
      },
    ]);
  });

  test("entries with an unknown severity are skipped", () => {
    expect(parseAuditReport(report("catastrophic"))).toEqual([]);
  });
});

describe("evaluateSecurity", () => {
  test("critical and high block, moderate warns, low is silent", () => {
    const advisories = [
      ...parseAuditReport(report("critical", "a", "GHSA-1111-1111-1111")),
      ...parseAuditReport(report("high", "b", "GHSA-2222-2222-2222")),
      ...parseAuditReport(report("moderate", "c", "GHSA-3333-3333-3333")),
      ...parseAuditReport(report("low", "d", "GHSA-4444-4444-4444")),
    ];
    const result = evaluateSecurity(advisories, [], NOW);
    expect(result.blocking.map((a) => a.package)).toEqual(["a", "b"]);
    expect(result.warnings.map((a) => a.package)).toEqual(["c"]);
    expect(result.counts).toMatchObject({ critical: 1, high: 1, moderate: 1, low: 1 });
  });

  test("a valid exception suppresses a high advisory", () => {
    const result = evaluateSecurity(parseAuditReport(report("high")), [securityException({})], NOW);
    expect(result.blocking).toEqual([]);
    expect(result.suppressed).toHaveLength(1);
  });

  test("an expired exception does not suppress", () => {
    const expired = securityException({ expires: "2026-10-01" });
    expect(
      evaluateSecurity(parseAuditReport(report("high")), [expired], NOW).blocking,
    ).toHaveLength(1);
  });

  test("an exception without an expiry never suppresses", () => {
    const forever = { ...securityException({}), expires: "" };
    expect(
      evaluateSecurity(parseAuditReport(report("high")), [forever], NOW).blocking,
    ).toHaveLength(1);
  });

  test("an exception for another package or advisory does not suppress", () => {
    const other = securityException({ package: "right-pad" });
    expect(evaluateSecurity(parseAuditReport(report("high")), [other], NOW).blocking).toHaveLength(
      1,
    );
  });
});

describe("runSecurityCheck", () => {
  test("a high advisory without an exception blocks, --report does not", async () => {
    const repoRoot = repoWithLockfile();
    const runAudit = async () => report("high");
    const base = { repoRoot, runAudit, exceptions: [], nowMs: NOW };
    expect(await runSecurityCheck({ ...base, reportOnly: false })).toBe(1);
    expect(await runSecurityCheck({ ...base, reportOnly: true })).toBe(0);
  });

  test("a high advisory covered by a comfortably valid exception passes", async () => {
    const repoRoot = repoWithLockfile();
    expect(
      await runSecurityCheck({
        repoRoot,
        reportOnly: false,
        runAudit: async () => report("high"),
        exceptions: [securityException({ expires: "2026-12-31" })],
        nowMs: NOW,
      }),
    ).toBe(0);
  });

  test(`an exception expiring within ${EXPIRY_BLOCK_DAYS} days blocks even though the advisory is covered`, async () => {
    const repoRoot = repoWithLockfile();
    const expiresInTenDays = securityException({ expires: "2026-10-26" });
    expect(
      await runSecurityCheck({
        repoRoot,
        reportOnly: false,
        runAudit: async () => report("high"),
        exceptions: [expiresInTenDays],
        nowMs: NOW,
      }),
    ).toBe(1);
  });

  test("an unused exception expiring soon does not block", async () => {
    const unusedExpiringSoon = securityException({
      advisory: "GHSA-zzzz-zzzz-zzzz",
      package: "other-pkg",
      expires: "2026-10-21",
    });
    expect(
      await runSecurityCheck({
        repoRoot: repoWithLockfile(),
        reportOnly: false,
        runAudit: async () => ({}),
        exceptions: [unusedExpiringSoon],
        nowMs: NOW,
      }),
    ).toBe(0);
  });

  test("an expired earlier exception does not shadow a valid later one for the same advisory", () => {
    const expiredBundled = securityException({ expires: "2026-10-01" });
    const renewedInRepo = securityException({ expires: "2026-12-31" });
    const evaluation = evaluateSecurity(
      parseAuditReport(report("high")),
      [expiredBundled, renewedInRepo],
      NOW,
    );
    expect(evaluation.blocking).toEqual([]);
    expect(evaluation.usedExceptions).toEqual([renewedInRepo]);
  });

  describe("unused exception warning", () => {
    async function runAndCaptureLog(
      exceptions: SecurityException[],
      raw: RawAuditReport,
      reportOnly = false,
    ): Promise<{ exitCode: number; log: string }> {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      try {
        const exitCode = await runSecurityCheck({
          repoRoot: repoWithLockfile(),
          reportOnly,
          runAudit: async () => raw,
          exceptions,
          nowMs: NOW,
        });
        return { exitCode, log: logSpy.mock.calls.map((call) => call.join(" ")).join("\n") };
      } finally {
        logSpy.mockRestore();
      }
    }

    test("an unused repo exception warns with package, advisory and file, and does not block", async () => {
      const unused = securityException({ advisory: "GHSA-vfj7-8cjw-p6xm", package: "braces" });
      for (const reportOnly of [false, true]) {
        const { exitCode, log } = await runAndCaptureLog([unused], {}, reportOnly);
        expect(exitCode).toBe(0);
        expect(log).toContain("suppressed no advisory");
        expect(log).toContain(
          "braces  GHSA-vfj7-8cjw-p6xm  (/repo/dependency-security-exceptions.json)",
        );
      }
    });

    test("a used repo exception does not warn", async () => {
      const { exitCode, log } = await runAndCaptureLog([securityException({})], report("high"));
      expect(exitCode).toBe(0);
      expect(log).not.toContain("suppressed no advisory");
    });

    test("an unused bundled exception does not warn", async () => {
      const bundled = securityException({
        source: { file: "/pkg/dependency-security-exceptions.json", origin: "bundled" },
      });
      const { exitCode, log } = await runAndCaptureLog([bundled], {});
      expect(exitCode).toBe(0);
      expect(log).not.toContain("suppressed no advisory");
    });
  });

  test("a clean audit passes", async () => {
    expect(
      await runSecurityCheck({
        repoRoot: repoWithLockfile(),
        reportOnly: false,
        runAudit: async () => ({}),
        exceptions: [],
        nowMs: NOW,
      }),
    ).toBe(0);
  });

  test("audits the lockfile directory it found, not the repo root, when they differ", async () => {
    const parent = repoWithLockfile();
    const repo = join(parent, "child");
    mkdirSync(repo, { recursive: true });
    const audited: string[] = [];
    await runSecurityCheck({
      repoRoot: repo,
      reportOnly: false,
      runAudit: async (dir) => {
        audited.push(dir);
        return {};
      },
      exceptions: [],
      nowMs: NOW,
    });
    expect(audited).toEqual([parent]);
  });

  test("a failing audit propagates instead of passing", async () => {
    await expect(
      runSecurityCheck({
        repoRoot: repoWithLockfile(),
        reportOnly: false,
        runAudit: async () => {
          throw new Error("bun audit failed");
        },
        exceptions: [],
        nowMs: NOW,
      }),
    ).rejects.toThrow("bun audit failed");
  });
});

describe("findLockfileDir", () => {
  test("prefers the repo root, falls back to an ancestor, undefined when none", () => {
    const parent = repoWithLockfile();
    const child = join(parent, "child");
    mkdirSync(child, { recursive: true });
    expect(findLockfileDir(parent)).toBe(parent);
    expect(findLockfileDir(child)).toBe(parent);
    writeFileSync(join(child, "bun.lock"), "{}", "utf-8");
    expect(findLockfileDir(child)).toBe(child);
  });
});

describe("loadSecurityExceptions", () => {
  test("the bundled default is empty and the repo file is merged in", () => {
    expect(loadSecurityExceptions([])).toEqual([]);
    const repo = repoWithLockfile();
    writeFileSync(
      join(repo, "dependency-security-exceptions.json"),
      JSON.stringify({ exceptions: [securityException({}), { advisory: "GHSA-x", package: "y" }] }),
      "utf-8",
    );
    const loaded = loadSecurityExceptions([repo]);
    expect(loaded.map((e) => e.advisory)).toEqual(["GHSA-aaaa-bbbb-cccc"]);
    expect(loaded[0]?.source).toEqual({
      file: join(repo, "dependency-security-exceptions.json"),
      origin: "repo",
    });
  });

  test("an exception with an unparsable expiry is dropped", () => {
    const repo = repoWithLockfile();
    writeFileSync(
      join(repo, "dependency-security-exceptions.json"),
      JSON.stringify({ exceptions: [securityException({ expires: "someday" })] }),
      "utf-8",
    );
    expect(loadSecurityExceptions([repo])).toEqual([]);
  });
});
