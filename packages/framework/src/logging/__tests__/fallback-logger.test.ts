// createFallbackLogger Unit-Tests (Phase 1, test-luecken-integration).
//
// Pinnt beide Pfade des Fallback-Loggers — inkl. des non-obvious
// Format-Unterschieds: der wrapped-Pfad schreibt "[ns] msg", der
// console-Fallback "[ns] msg:" (trailing colon).

import { describe, expect, mock, spyOn, test } from "bun:test";
import { createFallbackLogger } from "../utils";

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
  });

  describe("ohne logger (console-Fallback)", () => {
    test("schreibt auf console.error mit [namespace]-Prefix UND trailing colon", () => {
      const spy = spyOn(console, "error").mockImplementation(() => {});
      try {
        const fallback = createFallbackLogger("boot");

        fallback.error("no logger wired", { phase: "init" });

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith("[boot] no logger wired:", { phase: "init" });
      } finally {
        spy.mockRestore();
      }
    });
  });
});
