import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../../define-feature.ts";
import { validateHandlerAccess } from "../entity-handler.ts";

const phase = async () => ({ isSuccess: true as const, data: {} });

function featureWith(extra: Record<string, unknown>) {
  return defineFeature("nestedskip", (r) => {
    r.writeHandler({
      name: "work",
      schema: z.object({}),
      access: { roles: ["Admin"] },
      handler: async () => ({ isSuccess: true as const, data: {} }),
      ...extra,
    });
  });
}

describe("validateHandlerAccess — beforeTransactionWhenNested", () => {
  test("skip together with beforeTransaction boots", () => {
    const feature = featureWith({ beforeTransaction: phase, beforeTransactionWhenNested: "skip" });
    expect(() => validateHandlerAccess(feature)).not.toThrow();
  });

  test("skip without beforeTransaction is rejected with the handler name", () => {
    const feature = featureWith({ beforeTransactionWhenNested: "skip" });
    expect(() => validateHandlerAccess(feature)).toThrow(
      /nestedskip:write:work.*without beforeTransaction/,
    );
  });

  test("skip together with reserveBeforeTransaction is rejected", () => {
    const feature = featureWith({
      beforeTransaction: phase,
      reserveBeforeTransaction: async () => undefined,
      beforeTransactionWhenNested: "skip",
    });
    expect(() => validateHandlerAccess(feature)).toThrow(/reserveBeforeTransaction/);
  });

  test("skip together with transaction perCommand is rejected by the perCommand rule", () => {
    const feature = featureWith({
      beforeTransaction: phase,
      transaction: "perCommand",
      beforeTransactionWhenNested: "skip",
    });
    expect(() => validateHandlerAccess(feature)).toThrow(/perCommand/);
  });
});
