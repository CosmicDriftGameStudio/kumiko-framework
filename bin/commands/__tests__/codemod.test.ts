import { afterEach, describe, expect, test } from "bun:test";
import { makeContext, makeSpyOutput, makeTempCwd } from "../_test-helpers";
import { codemodCommand } from "../codemod";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups.length = 0;
});

describe("codemod command", () => {
  test("registered + maintainer-only", () => {
    expect(codemodCommand.id).toBe("codemod");
    expect(codemodCommand.roles).toEqual(["maintainer"]);
  });

  test("no subcommand prints usage + exits 0", async () => {
    const t = makeTempCwd();
    cleanups.push(t.cleanup);
    const spy = makeSpyOutput();
    const exit = await codemodCommand.run(makeContext({ cwd: t.cwd, out: spy.out }));
    expect(exit).toBe(0);
    expect(spy.logs.join("\n")).toMatch(/Usage: kumiko codemod pipeline/);
  });

  test("unknown subcommand prints usage + exits 1", async () => {
    const t = makeTempCwd();
    cleanups.push(t.cleanup);
    const spy = makeSpyOutput();
    const exit = await codemodCommand.run(
      makeContext({ cwd: t.cwd, argv: ["wrong"], out: spy.out }),
    );
    expect(exit).toBe(1);
  });
});
