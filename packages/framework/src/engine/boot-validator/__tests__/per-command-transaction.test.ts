import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../../define-feature.js";
import { validateHandlerAccess } from "../entity-handler.js";

function featureWith(extra: Record<string, unknown>) {
  return defineFeature("percommand", (r) => {
    r.writeHandler({
      name: "orchestrate",
      schema: z.object({}),
      access: { roles: ["Admin"] },
      transaction: "perCommand",
      handler: async () => ({ isSuccess: true as const, data: {} }),
      ...extra,
    });
  });
}

describe("validateHandlerAccess — transaction: perCommand", () => {
  test("a perCommand handler without pre-transaction phases boots", () => {
    expect(() => validateHandlerAccess(featureWith({}))).not.toThrow();
  });

  test("perCommand together with beforeTransaction is rejected with the handler name", () => {
    const feature = featureWith({
      beforeTransaction: async () => ({ isSuccess: true as const, data: {} }),
    });
    expect(() => validateHandlerAccess(feature)).toThrow(/percommand:write:orchestrate/);
    expect(() => validateHandlerAccess(feature)).toThrow(/beforeTransaction/);
  });

  test("perCommand together with reserveBeforeTransaction is rejected", () => {
    const feature = featureWith({ reserveBeforeTransaction: async () => undefined });
    expect(() => validateHandlerAccess(feature)).toThrow(/reserveBeforeTransaction/);
  });
});
