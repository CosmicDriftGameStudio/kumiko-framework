import { afterEach, describe, expect, test } from "bun:test";
import { makeContext, makeSpyOutput, makeTempCwd } from "../_test-helpers";
import { consumerCommand } from "../consumer";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups.length = 0;
});

describe("consumer command", () => {
  test("registered + maintainer-only", () => {
    expect(consumerCommand.id).toBe("consumer");
    expect(consumerCommand.roles).toEqual(["maintainer"]);
  });

  test("missing kumiko.config.ts emits helpful error", async () => {
    const t = makeTempCwd();
    cleanups.push(t.cleanup);
    const spy = makeSpyOutput();
    const exit = await consumerCommand.run(
      makeContext({ cwd: t.cwd, argv: ["list"], out: spy.out }),
    );
    expect(exit).toBe(1);
    expect(spy.errs.join("\n")).toMatch(/kumiko\.config\.ts not found/);
  });
});
