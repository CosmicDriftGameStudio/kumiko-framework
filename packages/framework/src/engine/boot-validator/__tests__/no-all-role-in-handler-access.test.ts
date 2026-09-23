import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineFeature } from "../../define-feature";
import { validateHandlerAccess } from "../entity-handler";

describe('validateHandlerAccess — roles: ["all"] is rejected', () => {
  test("a write handler with roles: ['all'] throws, naming the handler", () => {
    const feature = defineFeature("no-all-write", (r) => {
      r.writeHandler(
        "note:create",
        z.object({ title: z.string() }),
        async () => ({
          isSuccess: true as const,
          data: {},
        }),
        {
          access: { roles: ["all"] },
        },
      );
    });

    expect(() => validateHandlerAccess(feature)).toThrow(/no-all-write:write:note:create/);
    expect(() => validateHandlerAccess(feature)).toThrow(/no session ever carries the role "all"/);
  });

  test("a query handler with roles: ['all'] throws, naming the handler", () => {
    const feature = defineFeature("no-all-query", (r) => {
      r.queryHandler(
        "note:list",
        z.object({}),
        async () => ({ isSuccess: true as const, data: {} }),
        {
          access: { roles: ["all"] },
        },
      );
    });

    expect(() => validateHandlerAccess(feature)).toThrow(/no-all-query:query:note:list/);
  });

  test("openToAll access is unaffected", () => {
    const feature = defineFeature("open-to-all-ok", (r) => {
      r.writeHandler(
        "note:create",
        z.object({ title: z.string() }),
        async () => ({
          isSuccess: true as const,
          data: {},
        }),
        {
          access: { openToAll: { reason: "any signed-in user" } },
        },
      );
    });

    expect(() => validateHandlerAccess(feature)).not.toThrow();
  });

  test("roles: ['anonymous'] with a rateLimit boots fine", () => {
    const feature = defineFeature("anon-ok", (r) => {
      r.writeHandler(
        "note:create",
        z.object({ title: z.string() }),
        async () => ({
          isSuccess: true as const,
          data: {},
        }),
        {
          access: { roles: ["anonymous"] },
          rateLimit: { per: "ip", limit: 10, windowSeconds: 60 },
        },
      );
    });

    expect(() => validateHandlerAccess(feature)).not.toThrow();
  });
});
