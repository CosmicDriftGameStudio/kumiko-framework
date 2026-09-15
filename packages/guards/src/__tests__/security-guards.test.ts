import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSecurityGuard } from "../_lib/guard-kit";
import { resolveRepoRoots } from "../_lib/roots";
import { scanFiles } from "../_lib/scan-scope";
import { GUARDS } from "../run-guards";

const SECURITY_GUARD_NAMES = [
  "Access-Denied-Test Guard",
  "Admin-API Guard",
  "Direct-Entity-Writes Guard",
  "Direct-Fetch Guard",
  "Escape-Hatch-Declared Guard",
  "No-Direct-Fs Guard",
  "Open-To-All-Reason Guard",
  "Tenant-Escalation Guard",
];

describe("security guards — infra#787", () => {
  test("all eight named guards are security:true and reach every repo kind (scan.kinds unset)", () => {
    for (const name of SECURITY_GUARD_NAMES) {
      const guard = GUARDS.find((g) => g.name === name);
      expect(guard).toBeDefined();
      if (!guard) continue;
      expect(guard.security).toBe(true);
      expect(guard.scan.kinds).toBeUndefined();
      expect(isSecurityGuard(guard)).toBe(true);
    }
  });

  test("no other registered guard is accidentally marked security:true", () => {
    const flagged = GUARDS.filter(isSecurityGuard)
      .map((g) => g.name)
      .sort();
    expect(flagged).toEqual([...SECURITY_GUARD_NAMES].sort());
  });

  describe("flat-layout app repos are reached without git (roots.test.ts pattern)", () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => {
      for (const c of cleanups) c();
      cleanups.length = 0;
    });

    function workspace(): string {
      const root = mkdtempSync(join(tmpdir(), "security-guards-ws-"));
      cleanups.push(() => rmSync(root, { recursive: true, force: true }));
      return root;
    }

    function writePkg(dir: string, name: string): void {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name }), "utf-8");
    }

    function withCwd<T>(dir: string, fn: () => T): T {
      const prevCwd = process.cwd();
      process.chdir(dir);
      try {
        return fn();
      } finally {
        process.chdir(prevCwd);
      }
    }

    test("each security guard's scan reaches the app repo's src/", () => {
      const ws = workspace();
      const app = join(ws, "money-horse");
      writePkg(app, "money-horse");
      // bun.lock is the repo marker manifestRootAt() requires for a derived layout to count as a root.
      writeFileSync(join(app, "bun.lock"), "{}", "utf-8");
      mkdirSync(join(app, "src/features"), { recursive: true });
      writeFileSync(join(app, "src/features/x.ts"), "export {};\n");

      // process.chdir()/cwd() realpaths symlinked tmp dirs (macOS /var -> /private/var);
      // compare against the same realpath'd prefix resolveRepoRoots() sees.
      const appReal = realpathSync(app);
      for (const name of SECURITY_GUARD_NAMES) {
        const guard = GUARDS.find((g) => g.name === name);
        if (!guard) throw new Error(`missing guard ${name}`);
        const files = withCwd(app, () => scanFiles(guard.scan, resolveRepoRoots()));
        expect(files.some((f) => f.startsWith(join(appReal, "src")))).toBe(true);
      }
    });
  });
});
