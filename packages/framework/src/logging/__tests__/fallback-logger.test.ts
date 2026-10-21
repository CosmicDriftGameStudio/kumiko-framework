// createFallbackLogger Unit-Tests (Phase 1, test-luecken-integration).
//
// Pinnt beide Pfade des Fallback-Loggers auf das identische
// "[ns] msg"-Format — wrapped logger und console-Fallback dürfen
// nicht divergieren (Log-Parser/Grep-Konsistenz).

import { describe, expect, mock, spyOn, test } from "bun:test";
import type { Logger } from "../types.ts";
import { createFallbackLogger, setProcessLogger } from "../utils.ts";

describe("createFallbackLogger", () => {
  describe("mit wrapped logger", () => {
    test("delegiert an logger.error mit [namespace]-Prefix (kein colon)", () => {
      const error = mock((_msg: string, _data?: Record<string, unknown>) => {});
      const fallback = createFallbackLogger("redis", { error });

      fallback.error("connection lost", { attempt: 3 });

      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith("[redis] connection lost", { attempt: 3 });
    });

    test("reicht fehlendes data-Argument als undefined durch", () => {
      const error = mock((_msg: string, _data?: Record<string, unknown>) => {});
      const fallback = createFallbackLogger("jobs", { error });

      fallback.error("boom");

      expect(error).toHaveBeenCalledWith("[jobs] boom", undefined);
    });

    test("debug() delegiert an logger.debug wenn vorhanden (fw#1812: graceful-shutdown log-level downgrade)", () => {
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

    test("debug() fällt auf console.debug zurück wenn der wrapped logger keine debug-Methode hat", () => {
      const error = mock((_msg: string, _data?: Record<string, unknown>) => {});
      const spy = spyOn(console, "debug").mockImplementation(() => {});
      try {
        const fallback = createFallbackLogger("job-runner", { error });

        fallback.debug("connection is closed");

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith("[job-runner] connection is closed", undefined);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("ohne logger (console-Fallback)", () => {
    test("schreibt auf console.error mit [namespace]-Prefix im selben Format wie wrapped", () => {
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

    test("debug() schreibt auf console.debug mit [namespace]-Prefix", () => {
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

  describe("Prozess-Logger wechselt nach erster Nutzung", () => {
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

    test("folgt dem aktuellen Prozess-Logger und fällt nach null auf console zurück", () => {
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
        expect(spy).toHaveBeenCalledWith("[switch] three", undefined);
      } finally {
        setProcessLogger(null);
        spy.mockRestore();
      }
    });
  });
});
