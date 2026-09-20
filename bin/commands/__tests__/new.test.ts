import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { makeContext, makeSpyOutput, makeTempCwd } from "../_test-helpers";
import { newCommand } from "../new";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups.length = 0;
});

function tmp(): string {
  const t = makeTempCwd();
  cleanups.push(t.cleanup);
  return t.cwd;
}

describe("new command", () => {
  test("defined with correct metadata", () => {
    expect(newCommand.id).toBe("new");
    expect(newCommand.roles).toContain("maintainer");
    expect(newCommand.roles).toContain("app-dev");
  });

  test("scaffolds an app whose package.json pins @cosmicdrift/* to a caret range, not \"*\"", async () => {
    const cwd = tmp();
    const dest = join(cwd, "my-app");
    const spy = makeSpyOutput();
    const exit = await newCommand.run(
      makeContext({ cwd, argv: ["app", "my-app", "--dest", dest], out: spy.out }),
    );
    expect(exit).toBe(0);

    const pkg = JSON.parse(readFileSync(join(dest, "package.json"), "utf-8")) as {
      dependencies: Record<string, string>;
    };
    const cosmicDeps = Object.entries(pkg.dependencies).filter(([name]) =>
      name.startsWith("@cosmicdrift/"),
    );
    expect(cosmicDeps.length).toBeGreaterThan(0);
    for (const [, range] of cosmicDeps) {
      expect(range).not.toBe("*");
      expect(range).toMatch(/^\^\d+\.\d+\.\d+/);
    }
  });

  test("scaffolds the test template: e2e spec, playwright config, test scripts, testing devDependency", async () => {
    const cwd = tmp();
    const dest = join(cwd, "my-app");
    const exit = await newCommand.run(
      makeContext({ cwd, argv: ["app", "my-app", "--dest", dest], out: makeSpyOutput().out }),
    );
    expect(exit).toBe(0);

    expect(existsSync(join(dest, "playwright.config.ts"))).toBe(true);
    expect(existsSync(join(dest, "e2e/smoke.spec.ts"))).toBe(true);
    expect(existsSync(join(dest, "bunfig.integration.toml"))).toBe(true);
    expect(existsSync(join(dest, "bunfig.ci.toml"))).toBe(false);
    const pkg = JSON.parse(readFileSync(join(dest, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.scripts)).toEqual(
      expect.arrayContaining(["test", "test:integration", "e2e"]),
    );
    expect(pkg.devDependencies["@cosmicdrift/kumiko-testing"]).toMatch(/^\^\d+\.\d+\.\d+/);
    expect(pkg.devDependencies["@playwright/test"]).toBeDefined();
  });

  test("rejects a non-'app' subject", async () => {
    const cwd = tmp();
    const spy = makeSpyOutput();
    const exit = await newCommand.run(makeContext({ cwd, argv: ["feature", "x"], out: spy.out }));
    expect(exit).toBe(1);
  });

  test("rejects a missing app name", async () => {
    const cwd = tmp();
    const spy = makeSpyOutput();
    const exit = await newCommand.run(makeContext({ cwd, argv: ["app"], out: spy.out }));
    expect(exit).toBe(1);
  });
});
