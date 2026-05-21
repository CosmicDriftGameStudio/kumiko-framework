import { afterEach, describe, expect, test } from "vitest";
import { makeContext, makeSpyOutput, makeTempCwd } from "../_test-helpers";
import { doctorCommand } from "../doctor";

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

describe("doctor command", () => {
  test("registered + metadata", () => {
    expect(doctorCommand.id).toBe("doctor");
    expect(doctorCommand.category).toBe("lifecycle");
  });

  test("empty cwd reports missing .env + missing node_modules", async () => {
    const cwd = tmp();
    const spy = makeSpyOutput();
    const exit = await doctorCommand.run(makeContext({ cwd, out: spy.out }));
    expect(exit).toBe(1);
    const out = spy.logs.join("\n");
    expect(out).toMatch(/\.env file/);
    expect(out).toMatch(/cp \.env\.example/);
    expect(out).toMatch(/node_modules/);
    expect(out).toMatch(/yarn install/);
  });

  test("with .env present, the .env check is OK", async () => {
    const cwd = tmp({ ".env": "DATABASE_URL=postgres://x" });
    const spy = makeSpyOutput();
    await doctorCommand.run(makeContext({ cwd, out: spy.out }));
    const out = spy.logs.join("\n");
    // ✓ on .env line, ✗ on most other lines (no node_modules, no docker)
    expect(out).toMatch(/✓ \.env file/);
  });
});
