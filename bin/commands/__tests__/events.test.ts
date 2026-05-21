import { afterEach, describe, expect, test } from "vitest";
import { makeContext, makeSpyOutput, makeTempCwd } from "../_test-helpers";
import { eventsCommand } from "../events";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups.length = 0;
});

describe("events command", () => {
  test("registered + maintainer-only", () => {
    expect(eventsCommand.id).toBe("events");
    expect(eventsCommand.roles).toEqual(["maintainer"]);
  });

  test("no subcommand prints usage", async () => {
    const t = makeTempCwd();
    cleanups.push(t.cleanup);
    const spy = makeSpyOutput();
    const exit = await eventsCommand.run(makeContext({ cwd: t.cwd, out: spy.out }));
    expect(exit).toBe(1);
    expect(spy.logs.join("\n")).toMatch(/Usage: kumiko events prune/);
  });

  test("prune --older-than 0 is rejected", async () => {
    const t = makeTempCwd();
    cleanups.push(t.cleanup);
    const spy = makeSpyOutput();
    const exit = await eventsCommand.run(
      makeContext({ cwd: t.cwd, argv: ["prune", "--older-than", "0"], out: spy.out }),
    );
    expect(exit).toBe(1);
    expect(spy.errs.join("\n")).toMatch(/--older-than requires a positive number/);
  });

  test("prune without DATABASE_URL emits error", async () => {
    const t = makeTempCwd();
    cleanups.push(t.cleanup);
    const prev = process.env["DATABASE_URL"];
    delete process.env["DATABASE_URL"];
    try {
      const spy = makeSpyOutput();
      const exit = await eventsCommand.run(
        makeContext({ cwd: t.cwd, argv: ["prune", "--dry-run"], out: spy.out }),
      );
      expect(exit).toBe(1);
      expect(spy.errs.join("\n")).toMatch(/DATABASE_URL not set/);
    } finally {
      if (prev !== undefined) process.env["DATABASE_URL"] = prev;
    }
  });
});
