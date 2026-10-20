import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireGuardRunSlot, type GuardRunSlotOptions } from "../run-slots";

let slotsDir: string;

beforeEach(() => {
  slotsDir = mkdtempSync(join(tmpdir(), "guard-slots-test-"));
});

afterEach(() => {
  rmSync(slotsDir, { recursive: true, force: true });
});

function options(overrides: GuardRunSlotOptions): GuardRunSlotOptions {
  return {
    slotsDir,
    environment: { KUMIKO_GUARD_SLOTS: "1" },
    installProcessHooks: false,
    log: () => {},
    ...overrides,
  };
}

describe("acquireGuardRunSlot", () => {
  test("with one slot the second acquire waits until the first releases", () => {
    const releaseFirst = acquireGuardRunSlot(options({ pid: 111, isPidAlive: () => true }));
    const logged: string[] = [];
    let sleeps = 0;
    const releaseSecond = acquireGuardRunSlot(
      options({
        pid: 222,
        isPidAlive: () => true,
        log: (line) => logged.push(line),
        sleep: () => {
          sleeps++;
          if (sleeps === 3) releaseFirst();
        },
      }),
    );
    expect(sleeps).toBe(3);
    expect(logged).toEqual(["→ waiting for a free guard slot (1 in use)"]);
    expect(existsSync(join(slotsDir, "slot-0"))).toBe(true);
    releaseSecond();
    expect(readdirSync(slotsDir)).toEqual([]);
  });

  test("a slot whose owner pid is dead is taken over", () => {
    mkdirSync(join(slotsDir, "slot-0"));
    writeFileSync(join(slotsDir, "slot-0", "pid"), "999");
    const release = acquireGuardRunSlot(
      options({
        pid: 222,
        isPidAlive: (pid) => pid !== 999,
        sleep: () => {
          throw new Error("must not wait for an orphaned slot");
        },
      }),
    );
    expect(readdirSync(slotsDir)).toEqual(["slot-0"]);
    release();
    expect(readdirSync(slotsDir)).toEqual([]);
  });

  test("a pid-less slot is orphaned only after the grace period", () => {
    mkdirSync(join(slotsDir, "slot-0"));
    let clock = Date.now();
    let sleeps = 0;
    const release = acquireGuardRunSlot(
      options({
        pid: 222,
        now: () => clock,
        sleep: () => {
          sleeps++;
          clock += 61_000;
        },
      }),
    );
    expect(sleeps).toBe(1);
    release();
  });

  test("CI disables the limit", () => {
    const environment = { CI: "true", KUMIKO_GUARD_SLOTS: "1" };
    const first = acquireGuardRunSlot(options({ environment, pid: 111 }));
    const second = acquireGuardRunSlot(
      options({
        environment,
        pid: 222,
        sleep: () => {
          throw new Error("must not wait in CI");
        },
      }),
    );
    expect(readdirSync(slotsDir)).toEqual([]);
    first();
    second();
  });

  test("KUMIKO_GUARD_SLOTS=0 disables the limit", () => {
    acquireGuardRunSlot(options({ environment: { KUMIKO_GUARD_SLOTS: "0" } }))();
    expect(readdirSync(slotsDir)).toEqual([]);
  });

  test("release leaves a slot alone that was taken over by another pid", () => {
    const release = acquireGuardRunSlot(options({ pid: 111, isPidAlive: () => true }));
    writeFileSync(join(slotsDir, "slot-0", "pid"), "222");
    release();
    expect(existsSync(join(slotsDir, "slot-0"))).toBe(true);
  });

  test("a slot older than the max age is orphaned even if its pid is alive", () => {
    const release111 = acquireGuardRunSlot(options({ pid: 111, isPidAlive: () => true }));
    const release = acquireGuardRunSlot(
      options({
        pid: 222,
        isPidAlive: () => true,
        now: () => Date.now() + 16 * 60_000,
        sleep: () => {
          throw new Error("must not wait for a stale slot");
        },
      }),
    );
    release111();
    expect(existsSync(join(slotsDir, "slot-0"))).toBe(true);
    release();
    expect(readdirSync(slotsDir)).toEqual([]);
  });

  test("filesystem errors fail open without a slot", () => {
    const blocker = join(slotsDir, "blocker");
    writeFileSync(blocker, "");
    const logged: string[] = [];
    const release = acquireGuardRunSlot(
      options({ slotsDir: join(blocker, "slots"), log: (line) => logged.push(line) }),
    );
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/^→ guard slots unavailable \(\w+\), running without limit$/);
    release();
  });
});
