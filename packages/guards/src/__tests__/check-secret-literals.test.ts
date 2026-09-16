import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, secretLiteralOnLine } from "../check-secret-literals";
import { fixtureRoot } from "./parent-workspace-fixture";

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "secret-literal-guard-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

describe("secretLiteralOnLine", () => {
  test("flags a nullish-fallback to a hardcoded secret-like literal", () => {
    expect(secretLiteralOnLine('const s = env.JWT_SECRET ?? "hardcoded-prod-secret";')).toBe(
      "hardcoded-prod-secret",
    );
  });

  test("does not flag a line with no secret-context keyword", () => {
    expect(secretLiteralOnLine('const port = env.PORT ?? "3000";')).toBeNull();
  });

  test("does not flag a trivial/short fallback literal", () => {
    expect(secretLiteralOnLine('const v = env.SECRET_VERSION ?? "1";')).toBeNull();
  });
});

describe("Secret-Literal Guard (check.run)", () => {
  test("flags a hardcoded secret fallback in src/ outside bin/server.ts", async () => {
    const root = makeRepo({
      "src/config.ts":
        'export const hmacSecret = env.HMAC_SECRET ?? "cashcolt-mailer-hmac-secret";\n',
    });
    try {
      const repoRoot = fixtureRoot("fixture-app", root, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      });
      const outcome = await check.run([repoRoot]);
      expect(outcome.violations).toHaveLength(1);
      expect(outcome.violations[0]?.file).toBe("src/config.ts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not flag the same fallback inside bin/server.ts (dev entrypoint)", async () => {
    const root = makeRepo({
      "bin/server.ts":
        'export const hmacSecret = env.HMAC_SECRET ?? "cashcolt-mailer-hmac-secret";\n',
    });
    try {
      const repoRoot = fixtureRoot("fixture-app", root, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      });
      const outcome = await check.run([repoRoot]);
      expect(outcome.violations).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("is not applicable when no roots are resolved", async () => {
    const outcome = await check.run([]);
    expect(outcome.notApplicable).toBe(true);
    expect(outcome.violations).toEqual([]);
  });
});
