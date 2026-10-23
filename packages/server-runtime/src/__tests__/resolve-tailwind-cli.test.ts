// Unit tests for resolveTailwindCli: both failure branches prevent a dev-server crash
// when the network is unreliable; no Bun or an uninstalled package returns undefined.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canResolveTailwindStylesheet, resolveTailwindCli } from "../resolve-tailwind-cli.ts";

describe("resolveTailwindCli", () => {
  test("ohne Bun-Resolver → undefined (silent skip)", () => {
    const out = resolveTailwindCli({ bun: undefined, cwd: "/somewhere" });
    expect(out).toBeUndefined();
  });

  test("Bun.resolveSync wirft → undefined", () => {
    const out = resolveTailwindCli({
      bun: {
        resolveSync: () => {
          throw new Error("module not found");
        },
      },
      cwd: "/somewhere",
    });
    expect(out).toBeUndefined();
  });

  test("Bun.resolveSync liefert package.json → absoluter Bin-Pfad", () => {
    const out = resolveTailwindCli({
      bun: {
        resolveSync: () => "/repo/node_modules/@tailwindcss/cli/package.json",
      },
      cwd: "/repo",
    });
    expect(out).toBe("/repo/node_modules/@tailwindcss/cli/dist/index.mjs");
  });

  test("Bun-Resolver wird mit korrektem id und cwd aufgerufen", () => {
    const calls: Array<{ id: string; from: string }> = [];
    resolveTailwindCli({
      bun: {
        resolveSync: (id, from) => {
          calls.push({ id, from });
          return "/x/node_modules/@tailwindcss/cli/package.json";
        },
      },
      cwd: "/some/working/dir",
    });
    expect(calls).toEqual([{ id: "@tailwindcss/cli/package.json", from: "/some/working/dir" }]);
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
