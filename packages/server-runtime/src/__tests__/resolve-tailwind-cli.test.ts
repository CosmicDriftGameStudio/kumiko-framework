// Unit tests for the Tailwind lookups: no Bun or an uninstalled package returns undefined
// instead of crashing the dev server or triggering a registry auto-install.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canResolveTailwindStylesheet, resolveTailwindCli } from "../resolve-tailwind-cli.ts";

describe("resolveTailwindCli", () => {
  let root = "";
  const bun = { resolveSync: () => "unused" };

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "kumiko-tw-cli-")));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("installed → absolute bin path under the real package dir", () => {
    mkdirSync(join(root, "node_modules/@tailwindcss/cli"), { recursive: true });
    writeFileSync(join(root, "node_modules/@tailwindcss/cli/package.json"), "{}");
    const out = resolveTailwindCli({ bun, cwd: join(root, "apps/web") });
    expect(out).toBe(join(root, "node_modules/@tailwindcss/cli/dist/index.mjs"));
  });

  test("not installed → undefined", () => {
    expect(resolveTailwindCli({ bun, cwd: root })).toBeUndefined();
  });

  test("without Bun → undefined (silent skip)", () => {
    mkdirSync(join(root, "node_modules/@tailwindcss/cli"), { recursive: true });
    writeFileSync(join(root, "node_modules/@tailwindcss/cli/package.json"), "{}");
    expect(resolveTailwindCli({ bun: undefined, cwd: root })).toBeUndefined();
  });
});

describe("canResolveTailwindStylesheet", () => {
  let root = "";
  const resolvingBun = { resolveSync: () => "/bun-cache/tailwindcss@4/dist/lib.mjs" };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kumiko-tw-resolve-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("tailwindcss installed in an ancestor node_modules → true", () => {
    mkdirSync(join(root, "node_modules/tailwindcss"), { recursive: true });
    writeFileSync(join(root, "node_modules/tailwindcss/package.json"), "{}");
    const out = canResolveTailwindStylesheet(join(root, "packages/app/src/styles.css"), {
      bun: resolvingBun,
      cwd: join(root, "packages/app"),
    });
    expect(out).toBe(true);
  });

  test("no node_modules tree → false even when the Bun resolver auto-installs tailwindcss", () => {
    const out = canResolveTailwindStylesheet(
      join(root, "@cosmicdrift/kumiko-renderer/src/web/styles.css"),
      { bun: resolvingBun, cwd: root },
    );
    expect(out).toBe(false);
  });

  test("without Bun → false", () => {
    mkdirSync(join(root, "node_modules/tailwindcss"), { recursive: true });
    writeFileSync(join(root, "node_modules/tailwindcss/package.json"), "{}");
    const out = canResolveTailwindStylesheet(join(root, "src/styles.css"), {
      bun: undefined,
      cwd: root,
    });
    expect(out).toBe(false);
  });
});
