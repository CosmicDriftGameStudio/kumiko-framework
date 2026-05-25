// Unit-Tests für resolveTailwindCli — die zwei Failure-Branches sind
// genau das, was den dev-server-Crash bei flakigem Netz verhindert:
// kein Bun → undefined, Package nicht installiert → undefined.

import { describe, expect, test } from "bun:test";
import { canResolveTailwindStylesheet, resolveTailwindCli } from "../resolve-tailwind-cli";

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
  test("tailwindcss resolvable from entry dir → true", () => {
    const out = canResolveTailwindStylesheet("/repo/packages/app/src/styles.css", {
      bun: {
        resolveSync: (id, from) => {
          if (id === "tailwindcss" && from === "/repo/packages/app/src") {
            return "/repo/node_modules/tailwindcss/index.css";
          }
          throw new Error("not found");
        },
      },
      cwd: "/repo/packages/app",
    });
    expect(out).toBe(true);
  });

  test("tailwindcss not resolvable from entry dir → false", () => {
    const out = canResolveTailwindStylesheet(
      "/cache/@cosmicdrift/kumiko-renderer-web/src/styles.css",
      {
        bun: {
          resolveSync: () => {
            throw new Error("not found");
          },
        },
        cwd: "/tmp/minimal-fixture",
      },
    );
    expect(out).toBe(false);
  });
});
