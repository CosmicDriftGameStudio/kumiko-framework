import { afterEach, describe, expect, test } from "bun:test";
import { installFatalErrorHandlers } from "../fatal-error-handlers.ts";

type LoggedError = { msg: string; data: Record<string, unknown> | undefined };

function setup(stop: () => Promise<void>, hardExitMs?: number) {
  const logged: LoggedError[] = [];
  const exitCodes: number[] = [];
  let signalExit: () => void = () => {};
  const exited = new Promise<void>((resolve) => {
    signalExit = resolve;
  });
  const uninstall = installFatalErrorHandlers({
    logger: { error: (msg, data) => logged.push({ msg, data }) },
    stop,
    exit: (code) => {
      exitCodes.push(code);
      signalExit();
    },
    ...(hardExitMs !== undefined && { hardExitMs }),
  });
  return { logged, exitCodes, exited, uninstall };
}

describe("installFatalErrorHandlers", () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => uninstall?.());

  test("logs the scrubbed fault, stops and exits 1", async () => {
    let stopCalls = 0;
    const ctx = setup(async () => {
      stopCalls += 1;
    });
    uninstall = ctx.uninstall;

    process.emit("uncaughtException", new Error("lookup failed for anna@example.com"));
    await ctx.exited;

    expect(stopCalls).toBe(1);
    expect(ctx.exitCodes).toEqual([1]);
    expect(ctx.logged[0]?.data).toMatchObject({ fatal: true, source: "uncaughtException" });
    expect(JSON.stringify(ctx.logged[0])).not.toContain("anna@example.com");
  });

  test("a second fault while shutting down does not stop twice", async () => {
    let stopCalls = 0;
    const ctx = setup(async () => {
      stopCalls += 1;
    });
    uninstall = ctx.uninstall;

    process.emit("uncaughtException", new Error("first"));
    process.emit("unhandledRejection", new Error("second"), Promise.resolve());
    await ctx.exited;

    expect(stopCalls).toBe(1);
    expect(ctx.logged).toHaveLength(1);
  });

  test("a hanging stop is cut off by the hard-exit timer", async () => {
    const ctx = setup(() => new Promise<void>(() => {}), 5);
    uninstall = ctx.uninstall;

    process.emit("unhandledRejection", new Error("boom"), Promise.resolve());
    await ctx.exited;

    expect(ctx.exitCodes).toEqual([1]);
  });

  test("a failing stop is logged and the process still exits 1", async () => {
    const ctx = setup(async () => {
      throw new Error("close failed");
    });
    uninstall = ctx.uninstall;

    process.emit("uncaughtException", new Error("boom"));
    await ctx.exited;

    expect(ctx.logged.map((entry) => entry.msg)).toContain("shutdown after fatal error failed");
    expect(ctx.exitCodes).toEqual([1]);
  });

  test("uninstall removes the listeners", () => {
    const before = process.listenerCount("uncaughtException");
    const ctx = setup(async () => {});

    expect(process.listenerCount("uncaughtException")).toBe(before + 1);
    ctx.uninstall();
    expect(process.listenerCount("uncaughtException")).toBe(before);
  });
});
