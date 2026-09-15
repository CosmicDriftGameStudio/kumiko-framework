import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALLOWED_BIN_FILES,
  check,
  isScannableBinFile,
  processEnvOnLine,
  reposWithEnvTs,
  scanDirectProcessEnv,
} from "../guard-no-direct-process-env";
import { fixtureRoot } from "./parent-workspace-fixture";

describe("processEnvOnLine", () => {
  it("flags dot and bracket process.env access", () => {
    expect(processEnvOnLine(`const x = process.env.JWT_SECRET;`)).toBe(true);
    expect(processEnvOnLine(`const x = process.env["PORT"];`)).toBe(true);
    expect(processEnvOnLine(`foo(process.env[\`DATABASE_URL\`])`)).toBe(true);
  });

  it("ignores comments and non-env lines", () => {
    expect(processEnvOnLine(`// process.env.JWT_SECRET = "x";`)).toBe(false);
    expect(processEnvOnLine(`const env = { JWT_SECRET: "x" };`)).toBe(false);
  });
});

describe("isScannableBinFile", () => {
  it("allowlists env/server/kumiko only", () => {
    expect(ALLOWED_BIN_FILES.has("bin/env.ts")).toBe(true);
    expect(isScannableBinFile("bin/config-resolver.ts")).toBe(true);
    expect(isScannableBinFile("bin/server.ts")).toBe(false);
  });
});

// infra#721 originally covered KUMIKO_CLI_SCOPE/KUMIKO_GUARD_ROOTS narrowing
// a multi-repo scan — this single-repo package has no such env-scope
// machinery (resolveRepoRoots() only ever resolves the repo cwd sits in).
// What's still real here: only repos on the CANDIDATE_ENV_TS_REPOS
// allowlist with an actual bin/env.ts get scanned at all, and a clean repo
// doesn't get flagged by a violation elsewhere in the same `roots` array.
describe("reposWithEnvTs / scanDirectProcessEnv — roots-array behaviour", () => {
  const cleanups: Array<() => void> = [];
  function workspace(): string {
    const ws = mkdtempSync(join(tmpdir(), "no-direct-process-env-guard-"));
    cleanups.push(() => rmSync(ws, { recursive: true, force: true }));
    return ws;
  }

  function fakeRoot(dir: string, name: string, hasViolation: boolean) {
    mkdirSync(join(dir, "bin"), { recursive: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "bin", "env.ts"), "export const env = {};\n", "utf-8");
    writeFileSync(
      join(dir, "bin", "main.ts"),
      hasViolation
        ? 'const port = process.env["PORT"];\nexport { port };\n'
        : "export const port = 1;\n",
      "utf-8",
    );
    return fixtureRoot(name, dir, {
      kind: "app",
      sourceRoots: ["src"],
      testGlobs: ["src/**/*.test.ts"],
    });
  }

  it("keeps only candidate-allowlisted repos that ship bin/env.ts", () => {
    const ws = workspace();
    const moneyHorse = fakeRoot(join(ws, "money-horse"), "money-horse", false);
    const notCandidate = fakeRoot(join(ws, "solon"), "solon", false);

    expect(reposWithEnvTs([moneyHorse, notCandidate]).map((r) => r.name)).toEqual(["money-horse"]);
  });

  it("a violation in one root does not leak into a scan scoped to a clean root", () => {
    const ws = workspace();
    const moneyHorse = fakeRoot(join(ws, "money-horse"), "money-horse", false);
    const publicstatus = fakeRoot(join(ws, "publicstatus"), "publicstatus", true);

    expect(scanDirectProcessEnv([moneyHorse]).findings).toEqual([]);

    const fullScan = scanDirectProcessEnv([moneyHorse, publicstatus]);
    expect(fullScan.findings).toHaveLength(1);
    expect(fullScan.findings[0]?.file).toBe("publicstatus/bin/main.ts");

    for (const c of cleanups) c();
  });
});

describe("check.run — RepoCheck seam", () => {
  it("notApplicable when no root ships bin/env.ts", async () => {
    const outcome = await check.run([]);
    expect(outcome.notApplicable).toBe(true);
    expect(outcome.violations).toEqual([]);
  });

  it("reports a process.env finding as a violation", async () => {
    const ws = mkdtempSync(join(tmpdir(), "no-direct-process-env-check-"));
    try {
      mkdirSync(join(ws, "bin"), { recursive: true });
      mkdirSync(join(ws, "src"), { recursive: true });
      writeFileSync(join(ws, "bin", "env.ts"), "export const env = {};\n", "utf-8");
      writeFileSync(
        join(ws, "bin", "main.ts"),
        'const port = process.env["PORT"];\nexport { port };\n',
        "utf-8",
      );
      const root = fixtureRoot("money-horse", ws, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      });
      const outcome = await check.run([root]);
      expect(outcome.notApplicable).toBe(false);
      expect(outcome.violations).toHaveLength(1);
      expect(outcome.violations[0]?.file).toBe("money-horse/bin/main.ts");
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
