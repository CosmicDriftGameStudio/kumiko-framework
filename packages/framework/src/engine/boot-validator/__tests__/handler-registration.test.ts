import { describe, expect, spyOn, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createTextField } from "../../factories.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

  test("accepts bare CRUD write handler when feature name matches entity", () => {
    const features = [
      defineFeature("credit", (r) => {
        r.entity({
          name: "credit",
          ...createEntity({
            table: "Credits",
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.writeHandler({
          name: "create",
          schema: z.object({ name: z.string() }),
          handler: async () => ({
            isSuccess: true as const,
            data: { id: "1" },
          }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
    expect(features[0]?.handlerEntityMappings["create"]).toBe("credit");
  });

  test("throws when a write handler has no access rule", () => {
    // Access is a required option — the registrar itself throws
    // before validateBoot ever runs.
    expect(() =>
      defineFeature("a", (r) => {
        // @ts-expect-error options.access is required.
        r.writeHandler({
          name: "createThing",
          schema: z.object({ name: z.string() }),
          handler: async () => ({
            isSuccess: true as const,
            data: {},
          }),
        });
      }),
    ).toThrow(/r\.writeHandler\(\{ name: "createThing" \}\) requires an access rule/);
  });

  test("throws when a query handler has no access rule", () => {
    expect(() =>
      defineFeature("a", (r) => {
        // @ts-expect-error options.access is required.
        r.queryHandler({ name: "list", schema: z.object({}), handler: async () => [] });
      }),
    ).toThrow(/r\.queryHandler\(\{ name: "list" \}\) requires an access rule/);
  });

  test("validateBoot rejects a hand-built feature definition whose handler has no access rule", () => {
    const base = defineFeature("a", () => {});
    const handBuilt = {
      ...base,
      writeHandlers: {
        createThing: {
          name: "createThing",
          schema: z.object({}),
          handler: async () => ({ isSuccess: true as const, data: {} }),
          access: undefined,
        },
      },
    };
    // @ts-expect-error access is required on a stored handler; this is the hand-built bypass
    expect(() => validateBoot([handBuilt])).toThrow(/is missing an access rule/);
  });

  test("r.crud without access options fails registration (no implicit openToAll)", () => {
    const widgetEntity = createEntity({
      table: "phase0_widgets",
      fields: {
        name: createTextField({ required: true, personal: false, reason: "test_fixture" }),
      },
    });
    // Access is required — r.crud now throws at
    // registration time (was: caught at boot-validator level).
    expect(() =>
      defineFeature("phase0", (r) => {
        r.crud("widget", widgetEntity);
      }),
    ).toThrow(/no access rule resolved/i);
  });

  test("accepts role-based access rule", () => {
    const features = [
      defineFeature("a", (r) => {
        r.queryHandler({
          name: "list",
          schema: z.object({}),
          handler: async () => [],
          access: { roles: ["Admin"] },
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("accepts openToAll access rule", () => {
    const features = [
      defineFeature("a", (r) => {
        r.queryHandler({
          name: "list",
          schema: z.object({}),
          handler: async () => [],
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("warns when a role is used by exactly one handler, reached through the real validateBoot wiring", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const features = [
        defineFeature("a", (r) => {
          r.queryHandler({
            name: "list",
            schema: z.object({}),
            handler: async () => [],
            access: { roles: ["OnlyHereRole"] },
          });
        }),
      ];
      validateBootRaw(withBootValidatorFixture(features), { warnOnUniqueAccessRoles: true });
      // Not toHaveBeenCalledTimes(1): this file's tests share the process-global
      // console.warn and run with the default concurrency (bunfig.toml) — other
      // concurrently-running tests' own "role used by one handler" warnings can
      // land on this spy too. Assert the wiring fired at least once instead.
      expect(
        warnSpy.mock.calls.some((call) =>
          (call[0] as string | undefined)?.includes("OnlyHereRole"),
        ),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("does NOT warn on unique access roles by default — opt-in only", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const features = [
        defineFeature("b", (r) => {
          r.queryHandler({
            name: "list",
            schema: z.object({}),
            handler: async () => [],
            access: { roles: ["OnlyThereRole"] },
          });
        }),
      ];
      validateBoot(features);
      expect(
        warnSpy.mock.calls.some((call) =>
          (call[0] as string | undefined)?.includes("OnlyThereRole"),
        ),
      ).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("throws when a stream handler has no access rule", () => {
    expect(() =>
      defineFeature("a", (r) => {
        // @ts-expect-error options.access is required.
        r.streamHandler("chat:complete", z.object({}), async function* () {});
      }),
    ).toThrow(/requires schema \+ handler \+ options\.access/);
  });

  test("object-form streamHandler with access rule passes boot", () => {
    const features = [
      defineFeature("a", (r) => {
        r.streamHandler({
          name: "chat:complete",
          schema: z.object({}),
          handler: async function* () {},
          access: { roles: ["User"] },
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("accepts openToAll access rule on a stream handler", () => {
    const features = [
      defineFeature("a", (r) => {
        r.streamHandler("chat:complete", z.object({}), async function* () {}, {
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("throws when an anonymous stream handler uses a user-bucketed rate limit", () => {
    const features = [
      defineFeature("a", (r) => {
        r.streamHandler("chat:complete", z.object({}), async function* () {}, {
          access: { roles: ["anonymous"] },
          rateLimit: { per: "user", limit: 10, windowSeconds: 60 },
        });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(
      /stream handler "a:stream:chat:complete" allows anonymous callers/i,
    );
  });

  test("accepts an anonymous stream handler with an ip-bucketed rate limit", () => {
    const features = [
      defineFeature("a", (r) => {
        r.streamHandler("chat:complete", z.object({}), async function* () {}, {
          access: { roles: ["anonymous"] },
          rateLimit: { per: "ip", limit: 10, windowSeconds: 60 },
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  describe("additionalRateLimits", () => {
    const emailBucket = [{ per: { payloadField: "email" }, limit: 3, windowSeconds: 86400 }];
    const mailSchema = z.object({ email: z.string() });
    const handlerResult = async () => ({ isSuccess: true as const, data: {} });

    test("throws for an anonymous handler without rateLimit", () => {
      const features = [
        defineFeature("a", (r) => {
          r.writeHandler({
            name: "request",
            schema: mailSchema,
            handler: handlerResult,
            access: { roles: ["anonymous"] },
            additionalRateLimits: emailBucket,
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/write handler "a:write:request"/);
    });

    test("throws for an anonymous handler with a disabled rateLimit", () => {
      const features = [
        defineFeature("a", (r) => {
          r.writeHandler({
            name: "request",
            schema: mailSchema,
            handler: handlerResult,
            access: { roles: ["anonymous"] },
            rateLimit: { disabled: true, reason: "test" },
            additionalRateLimits: emailBucket,
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/no ip-keyed rateLimit/);
    });

    test("throws for an anonymous handler with a user-bucketed rateLimit", () => {
      const features = [
        defineFeature("a", (r) => {
          r.writeHandler({
            name: "request",
            schema: mailSchema,
            handler: handlerResult,
            access: { roles: ["anonymous"] },
            rateLimit: { per: "tenant", limit: 10, windowSeconds: 60 },
            additionalRateLimits: emailBucket,
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/no ip-keyed rateLimit/);
    });

    test("throws when payloadField is not in the schema", () => {
      const features = [
        defineFeature("a", (r) => {
          r.writeHandler({
            name: "request",
            schema: mailSchema,
            handler: handlerResult,
            access: { roles: ["anonymous"] },
            rateLimit: { per: "ip+handler", limit: 10, windowSeconds: 60 },
            additionalRateLimits: [{ per: { payloadField: "emial" }, limit: 3, windowSeconds: 60 }],
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/payloadField "emial"/);
    });

    test("throws for an empty array and for non-positive limits", () => {
      const withLimits = (additionalRateLimits: typeof emailBucket) => [
        defineFeature("a", (r) => {
          r.writeHandler({
            name: "request",
            schema: mailSchema,
            handler: handlerResult,
            access: { roles: ["anonymous"] },
            rateLimit: { per: "ip", limit: 10, windowSeconds: 60 },
            additionalRateLimits,
          });
        }),
      ];
      expect(() => validateBoot(withLimits([]))).toThrow(/empty array/);
      expect(() =>
        validateBoot(withLimits([{ per: { payloadField: "email" }, limit: 0, windowSeconds: 60 }])),
      ).toThrow(/positive integer/);
    });

    test("accepts an anonymous handler with an ip-keyed rateLimit and a schema field", () => {
      const features = [
        defineFeature("a", (r) => {
          r.writeHandler({
            name: "request",
            schema: mailSchema,
            handler: handlerResult,
            access: { roles: ["anonymous"] },
            rateLimit: { per: "ip+handler", limit: 10, windowSeconds: 60 },
            additionalRateLimits: emailBucket,
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });
  });
