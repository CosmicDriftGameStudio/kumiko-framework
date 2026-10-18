import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { installShutdownSignals, type SignalProcess } from "../process-signals.js";

function fakeProcess(): SignalProcess & { emit(signal: string): void; count(): number } {
  const emitter = new EventEmitter();
  return {
    on: (signal, listener) => emitter.on(signal, listener),
    off: (signal, listener) => emitter.off(signal, listener),
    emit: (signal) => {
      emitter.emit(signal);
    },
    count: () => emitter.listenerCount("SIGTERM") + emitter.listenerCount("SIGINT"),
  };
}

function exitRecorder(): {
  readonly codes: number[];
  readonly exited: Promise<number>;
  exit(code: number): void;
} {
  const codes: number[] = [];
  let resolveExit: (code: number) => void = () => {};
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  return {
    codes,
    exited,
    exit: (code) => {
      codes.push(code);
      resolveExit(code);
    },
  };
}

const silent = { log: () => {}, logError: () => {} };

describe("installShutdownSignals", () => {
  test("SIGTERM drains via stop() and exits 0", async () => {
    const signalProcess = fakeProcess();
    const recorder = exitRecorder();
    let stopCalls = 0;
    installShutdownSignals({
      stop: async () => {
        stopCalls += 1;
      },
      signalProcess,
      exit: recorder.exit,
      ...silent,
    });

    signalProcess.emit("SIGTERM");

    expect(await recorder.exited).toBe(0);
    expect(stopCalls).toBe(1);
  });

  test("a second signal during the drain does not call stop() again", async () => {
    const signalProcess = fakeProcess();
    const recorder = exitRecorder();
    let stopCalls = 0;
    let releaseStop: () => void = () => {};
    installShutdownSignals({
      stop: () => {
        stopCalls += 1;
        return new Promise<void>((resolve) => {
          releaseStop = resolve;
        });
      },
      signalProcess,
      exit: recorder.exit,
      ...silent,
    });

    signalProcess.emit("SIGINT");
    signalProcess.emit("SIGTERM");
    releaseStop();

    expect(await recorder.exited).toBe(0);
    expect(stopCalls).toBe(1);
    expect(recorder.codes).toEqual([0]);
  });

  test("a drain that outlives the timeout exits 1", async () => {
    const signalProcess = fakeProcess();
    const recorder = exitRecorder();
    installShutdownSignals({
      stop: () => new Promise<void>(() => {}),
      drainTimeoutMs: 5,
      signalProcess,
      exit: recorder.exit,
      ...silent,
    });

    signalProcess.emit("SIGTERM");

    expect(await recorder.exited).toBe(1);
  });

  test("a failing stop() exits 1", async () => {
    const signalProcess = fakeProcess();
    const recorder = exitRecorder();
    installShutdownSignals({
      stop: async () => {
        throw new Error("redis gone");
      },
      signalProcess,
      exit: recorder.exit,
      ...silent,
    });

    signalProcess.emit("SIGTERM");

    expect(await recorder.exited).toBe(1);
  });

  test("the returned uninstall removes both listeners", () => {
    const signalProcess = fakeProcess();
    const uninstall = installShutdownSignals({
      stop: async () => {},
      signalProcess,
      exit: () => {},
      ...silent,
    });
    expect(signalProcess.count()).toBe(2);

    uninstall();

    expect(signalProcess.count()).toBe(0);
  });
});
