import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, scanLinesForSecretLiterals } from "../check-secret-literals";
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

const flaggedNames = (lines: string[]) => scanLinesForSecretLiterals(lines).map((h) => h.name);

describe("scanLinesForSecretLiterals", () => {
  test("flags a nullish-fallback to a hardcoded secret-like literal", () => {
    const hits = scanLinesForSecretLiterals([
      'const s = env.JWT_SECRET ?? "hardcoded-prod-secret";',
    ]);
    expect(hits).toEqual([{ lineNumber: 1, name: "JWT_SECRET", literalLength: 21 }]);
  });

  test("does not flag a line with no secret-like name left of the fallback", () => {
    expect(flaggedNames(['const port = env.PORT ?? "3000";'])).toEqual([]);
  });

  test("does not flag a trivial/short fallback literal", () => {
    expect(flaggedNames(['const v = env.SECRET_VERSION ?? "1";'])).toEqual([]);
  });

  test("does not flag lines inside an open block comment, even without a leading *", () => {
    expect(
      flaggedNames([
        "/**",
        ' * const s = env.JWT_SECRET ?? "hardcoded-prod-secret";',
        '   const t = env.JWT_SECRET ?? "hardcoded-prod-secret";',
        " */",
      ]),
    ).toEqual([]);
  });

  test("flags code after a closing */ on the same line", () => {
    expect(
      flaggedNames(["/* note", '*/ const s = env.JWT_SECRET ?? "hardcoded-prod-secret";']),
    ).toEqual(["JWT_SECRET"]);
  });

  test("ignores a block comment that opens and closes inside one line", () => {
    expect(flaggedNames(['/* env.JWT_SECRET ?? "hardcoded-prod-secret" */ const x = 1;'])).toEqual(
      [],
    );
  });

  test("checks a wrapped code line that starts with * outside any block comment", () => {
    expect(flaggedNames(["const s = a", '  * env.JWT_SECRET ?? "hardcoded-prod-secret";'])).toEqual(
      ["JWT_SECRET"],
    );
  });

  test("does not flag a pure // comment line", () => {
    expect(flaggedNames(['// const s = env.JWT_SECRET ?? "hardcoded-prod-secret";'])).toEqual([]);
  });

  test("a /* inside a string literal does not open a block comment", () => {
    expect(
      flaggedNames(['const g = "src/*";', 'const s = env.JWT_SECRET ?? "hardcoded-prod-secret";']),
    ).toEqual(["JWT_SECRET"]);
  });

  test("still flags a connection-string fallback with // in the literal", () => {
    expect(
      flaggedNames(['const dbSecretUrl = env.DB_URL ?? "postgres://user:pass@host/db";']),
    ).toEqual(["dbSecretUrl"]);
  });

  test("flags a property-style assignee", () => {
    expect(flaggedNames(['hmacSecret: config.X ?? "cashcolt-mailer-hmac-secret",'])).toEqual([
      "hmacSecret",
    ]);
  });

  test("does not flag labels whose fallback text merely mentions secret/password", () => {
    expect(flaggedNames(['const label = cfg.title ?? "Secret Santa";'])).toEqual([]);
    expect(flaggedNames(['const msg = t("auth.err") ?? "password required here";'])).toEqual([]);
  });

  test("kumiko-lint-ignore secret-literal on the line or the line above opts out", () => {
    expect(
      flaggedNames([
        "// kumiko-lint-ignore secret-literal local-only fixture secret",
        'const s = env.JWT_SECRET ?? "hardcoded-prod-secret";',
      ]),
    ).toEqual([]);
    expect(
      flaggedNames([
        'const s = env.JWT_SECRET ?? "hardcoded-prod-secret"; // kumiko-lint-ignore secret-literal fixture',
      ]),
    ).toEqual([]);
    expect(
      flaggedNames([
        "// kumiko-lint-ignore no-inline-styles unrelated slug",
        'const s = env.JWT_SECRET ?? "hardcoded-prod-secret";',
      ]),
    ).toEqual(["JWT_SECRET"]);
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
      expect(outcome.violations[0]?.message).toBe(
        'hardcoded secret fallback for "hmacSecret" (27 chars)',
      );
      expect(outcome.violations[0]?.message).not.toContain("cashcolt");
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
        sourceRoots: ["src", "bin"],
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
