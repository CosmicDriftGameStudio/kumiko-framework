// createFallbackLogger unit tests.
//
// Both fallback logger paths use the same "[ns] msg" format — the wrapped
// logger and console fallback must not diverge to keep log parsing and grep
// consistent.

import { describe, expect, mock, spyOn, test } from "bun:test";
import type { Logger } from "../types.ts";
import { createFallbackLogger, setProcessLogger } from "../utils.ts";

describe("createFallbackLogger", () => {
  describe("with a wrapped logger", () => {
    test("delegates to logger.error with [namespace] prefix (no colon)", () => {
      const error = mock((_msg: string, _data?: Record<string, unknown>) => {});
      const fallback = createFallbackLogger("redis", { error });

      fallback.error("connection lost", { attempt: 3 });

      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith("[redis] connection lost", { attempt: 3 });
    });

    test("passes a missing data argument through as undefined", () => {
      const error = mock((_msg: string, _data?: Record<string, unknown>) => {});
      const fallback = createFallbackLogger("jobs", { error });

      fallback.error("boom");

      expect(error).toHaveBeenCalledWith("[jobs] boom", undefined);
    });

    test("debug() delegates to logger.debug when available (graceful-shutdown log-level downgrade)", () => {
      const error = mock((_msg: string, _data?: Record<string, unknown>) => {});
      const debug = mock((_msg: string, _data?: Record<string, unknown>) => {});
      const fallback = createFallbackLogger("job-runner", { error, debug });

      fallback.debug("connection is closed", { reason: "graceful-shutdown" });

      expect(debug).toHaveBeenCalledTimes(1);
      expect(debug).toHaveBeenCalledWith("[job-runner] connection is closed", {
        reason: "graceful-shutdown",
      });
      expect(error).not.toHaveBeenCalled();
    });

    test("debug() falls back to console.debug when the wrapped logger has no debug method", () => {
      const error = mock((_msg: string, _data?: Record<string, unknown>) => {});
      const spy = spyOn(console, "debug").mockImplementation(() => {});
      try {
        const fallback = createFallbackLogger("job-runner", { error });

        fallback.debug("connection is closed");

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]).toEqual(["[job-runner] connection is closed"]);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("with a wrapped logger that supports child()", () => {
    test("binds component via child and logs all levels without a prefix", () => {
      const calls: string[] = [];
      const childLogger: Logger = {
        info: (msg) => void calls.push(`info:${msg}`),
        warn: (msg) => void calls.push(`warn:${msg}`),
        error: (msg) => void calls.push(`error:${msg}`),
        debug: (msg) => void calls.push(`debug:${msg}`),
        child: () => childLogger,
      };
      const child = mock((_bindings: Record<string, unknown>) => childLogger);
      const error = mock((_msg: string, _data?: Record<string, unknown>) => {});
      const fallback = createFallbackLogger("redis", { error, child });

      fallback.info("a");
      fallback.warn("b");
      fallback.error("c");
      fallback.debug("d");

      expect(child).toHaveBeenCalledTimes(1);
      expect(child).toHaveBeenCalledWith({ component: "redis" });
      expect(calls).toEqual(["info:a", "warn:b", "error:c", "debug:d"]);
      expect(error).not.toHaveBeenCalled();
    });
  });

  describe("without a logger (console fallback)", () => {
    test("writes to console.error with [namespace] prefix in the same format as wrapped", () => {
      const spy = spyOn(console, "error").mockImplementation(() => {});
      try {
        const fallback = createFallbackLogger("boot");

        fallback.error("no logger wired", { phase: "init" });

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith("[boot] no logger wired", { phase: "init" });
      } finally {
        spy.mockRestore();
      }
    });

    test("without data, only one argument is passed to console.warn", () => {
      const spy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const fallback = createFallbackLogger("boot");

        fallback.warn("plain");
        fallback.warn("with data", { phase: "init" });

        expect(spy.mock.calls[0]).toEqual(["[boot] plain"]);
        expect(spy.mock.calls[1]).toEqual(["[boot] with data", { phase: "init" }]);
      } finally {
        spy.mockRestore();
      }
    });

    test("debug() writes to console.debug with [namespace] prefix", () => {
      const spy = spyOn(console, "debug").mockImplementation(() => {});
      try {
        const fallback = createFallbackLogger("boot");

        fallback.debug("no logger wired", { phase: "init" });

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith("[boot] no logger wired", { phase: "init" });
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("process logger switches after first use", () => {
    const recordingLogger = (calls: string[]): Logger => {
      const logger: Logger = {
        info: (msg) => void calls.push(`info:${msg}`),
        warn: (msg) => void calls.push(`warn:${msg}`),
        error: (msg) => void calls.push(`error:${msg}`),
        debug: (msg) => void calls.push(`debug:${msg}`),
        child: () => logger,
      };
      return logger;
    };

    test("follows the current process logger and falls back to console after null", () => {
      const first: string[] = [];
      const second: string[] = [];
      const spy = spyOn(console, "info").mockImplementation(() => {});
      try {
        const fallback = createFallbackLogger("switch");

        setProcessLogger(recordingLogger(first));
        fallback.info("one");
        setProcessLogger(recordingLogger(second));
        fallback.info("two");
        setProcessLogger(null);
        fallback.info("three");

        expect(first).toEqual(["info:one"]);
        expect(second).toEqual(["info:two"]);
        expect(spy.mock.calls[0]).toEqual(["[switch] three"]);
      } finally {
        setProcessLogger(null);
        spy.mockRestore();
      }
    });
  });
});
