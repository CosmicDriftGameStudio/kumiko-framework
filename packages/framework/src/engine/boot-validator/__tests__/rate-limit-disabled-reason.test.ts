import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../../define-feature";
import { validateHandlerAccess } from "../entity-handler";

describe("validateHandlerAccess — rateLimit: { disabled: true } reason", () => {
  test("an empty reason throws, naming the handler", () => {
    const feature = defineFeature("rl-guard", (r) => {
      r.writeHandler(
        "note:create",
        z.object({ title: z.string() }),
        async () => ({
          isSuccess: true as const,
          data: {},
        }),
        {
          access: { roles: ["Admin"] },
          rateLimit: { disabled: true, reason: "" },
        },
      );
    });

    expect(() => validateHandlerAccess(feature)).toThrow(/rl-guard:write:note:create/);
    expect(() => validateHandlerAccess(feature)).toThrow(/rateLimit: \{ disabled: true \}/);
  });

  test("a non-empty reason boots fine", () => {
    const feature = defineFeature("rl-guard", (r) => {
      r.writeHandler(
        "note:create",
        z.object({ title: z.string() }),
        async () => ({
          isSuccess: true as const,
          data: {},
        }),
        {
          access: { roles: ["Admin"] },
          rateLimit: { disabled: true, reason: "ops replay path" },
        },
      );
    });

    expect(() => validateHandlerAccess(feature)).not.toThrow();
  });
});
