import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { makeContext, makeSpyOutput, makeTempCwd } from "../_test-helpers";
import { createCommand } from "../create";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups.length = 0;
});

function tmp(files?: Record<string, string>): string {
  const t = makeTempCwd(files);
  cleanups.push(t.cleanup);
  return t.cwd;
}

describe("create command", () => {
  test("registered + metadata", () => {
    expect(createCommand.id).toBe("create");
    expect(createCommand.roles).toContain("maintainer");
    expect(createCommand.roles).toContain("app-dev");
  });

  test("without name prints usage + exits 1", async () => {
    const cwd = tmp();
    const spy = makeSpyOutput();
    const exit = await createCommand.run(makeContext({ cwd, argv: [], out: spy.out }));
    expect(exit).toBe(1);
    expect(spy.errs.join("\n")).toMatch(/Usage: kumiko create/);
  });

  test("with name + --path scaffolds the feature", async () => {
    const cwd = tmp();
    const dest = join(cwd, "my-feature-pkg");
    const spy = makeSpyOutput();
    const exit = await createCommand.run(
      makeContext({
        cwd,
        argv: ["myFeature", "--path", dest],
        out: spy.out,
      }),
    );
    expect(exit).toBe(0);
    expect(existsSync(join(dest, "package.json"))).toBe(true);
    expect(existsSync(join(dest, "src/feature.ts"))).toBe(true);
    expect(spy.logs.join("\n")).toMatch(/Feature scaffolded/);
  });

  test("invalid name (not camelCase) emits error", async () => {
    const cwd = tmp();
    const spy = makeSpyOutput();
    const exit = await createCommand.run(
      makeContext({
        cwd,
        argv: ["snake_case_name", "--path", join(cwd, "nope")],
        out: spy.out,
      }),
    );
    expect(exit).toBe(1);
    expect(spy.errs.length).toBeGreaterThan(0);
  });
});
