import { describe, expectTypeOf, test } from "bun:test";
import type {
  EscapeHatchDeclaration,
  EscapeHatchGrant,
  GrantedHandlerContext,
  HandlerContext,
  SystemScopeHandlerContext,
} from "@cosmicdrift/kumiko-types/handlers";
import type {
  CrossTenantReads,
  UncheckedSystemDb,
} from "@cosmicdrift/kumiko-types/tenant-db-types";
import * as z from "zod";
import type { TenantDb } from "../../db/index.ts";
import {
  hasOutsideTransactionDb,
  hasSystemDb,
  requireOutsideTransactionDb,
} from "../../db/tenant-db.ts";
import {
  definePagedQueryHandler,
  defineQueryHandler,
  defineWriteHandler,
} from "../define-handler.ts";

test("dbOutsideTransaction stays optional and hasOutsideTransactionDb narrows it", () => {
  expectTypeOf<HandlerContext["db"]["outsideTransaction"]>().toEqualTypeOf<TenantDb | undefined>();
  const narrow = (ctx: HandlerContext) => {
    if (hasOutsideTransactionDb(ctx)) {
      expectTypeOf(ctx.db.outsideTransaction).toEqualTypeOf<TenantDb>();
    }
  };
  expectTypeOf(narrow).toBeFunction();
  expectTypeOf(requireOutsideTransactionDb).returns.toEqualTypeOf<TenantDb>();
});

describe("systemScope handler declaration", () => {
  const schema = z.object({});
  const access = { roles: ["SystemAdmin"] };

  test("SystemScopeHandlerContext makes systemDb non-optional", () => {
    expectTypeOf<SystemScopeHandlerContext["systemDb"]>().toEqualTypeOf<UncheckedSystemDb>();
    expectTypeOf<HandlerContext["systemDb"]>().toEqualTypeOf<UncheckedSystemDb | undefined>();
  });

  test("hasSystemDb narrows HandlerContext", () => {
    const narrow = (ctx: HandlerContext) => {
      if (hasSystemDb(ctx)) {
        expectTypeOf(ctx.systemDb).toEqualTypeOf<UncheckedSystemDb>();
      }
    };
    expectTypeOf(narrow).toBeFunction();
  });

  test("defineWriteHandler types ctx.systemDb by the marker", () => {
    const declared = defineWriteHandler({
      name: "probe:declared",
      schema,
      access,
      systemScope: true,
      handler: async (_event, ctx) => {
        expectTypeOf(ctx.systemDb).toEqualTypeOf<UncheckedSystemDb>();
        return { isSuccess: true as const, data: {} };
      },
    });
    const undeclared = defineWriteHandler({
      name: "probe:undeclared",
      schema,
      access,
      handler: async (_event, ctx) => {
        expectTypeOf(ctx.systemDb).toEqualTypeOf<UncheckedSystemDb | undefined>();
        return { isSuccess: true as const, data: {} };
      },
    });
    expectTypeOf(declared.handler).toBeFunction();
    expectTypeOf(undeclared.handler).toBeFunction();
  });

  test("defineQueryHandler types ctx.systemDb by the marker", () => {
    const declared = defineQueryHandler({
      name: "probe:declared-query",
      schema,
      access,
      systemScope: true,
      handler: async (_query, ctx) => {
        expectTypeOf(ctx.systemDb).toEqualTypeOf<UncheckedSystemDb>();
        return {};
      },
    });
    const undeclared = defineQueryHandler({
      name: "probe:undeclared-query",
      schema,
      access,
      handler: async (_query, ctx) => {
        expectTypeOf(ctx.systemDb).toEqualTypeOf<UncheckedSystemDb | undefined>();
        return {};
      },
    });
    expectTypeOf(declared.handler).toBeFunction();
    expectTypeOf(undeclared.handler).toBeFunction();
  });

  test("definePagedQueryHandler types ctx.systemDb by the marker", () => {
    const declared = definePagedQueryHandler({
      name: "probe:declared-paged",
      schema,
      access,
      systemScope: true,
      handler: async (_query, ctx) => {
        expectTypeOf(ctx.systemDb).toEqualTypeOf<UncheckedSystemDb>();
        return { rows: [], nextCursor: null };
      },
    });
    const undeclared = definePagedQueryHandler({
      name: "probe:undeclared-paged",
      schema,
      access,
      handler: async (_query, ctx) => {
        expectTypeOf(ctx.systemDb).toEqualTypeOf<UncheckedSystemDb | undefined>();
        return { rows: [], nextCursor: null };
      },
    });
    expectTypeOf(declared.handler).toBeFunction();
    expectTypeOf(undeclared.handler).toBeFunction();
  });
});

describe("crossTenantReads grant", () => {
  const schema = z.object({});
  const access = { roles: ["SystemAdmin"] };

  test("a crossTenantReads grant makes ctx.crossTenantReads non-optional on defineWriteHandler", () => {
    const def = defineWriteHandler({
      name: "probe:granted",
      schema,
      access,
      escapeHatch: { reason: "probe", grants: ["crossTenantReads"] },
      handler: async (_event, ctx) => {
        expectTypeOf(ctx.crossTenantReads).toEqualTypeOf<CrossTenantReads>();
        return { isSuccess: true as const, data: {} };
      },
    });
    expectTypeOf(def.handler).toBeFunction();
  });

  test("crossTenantReads next to another grant is still non-optional", () => {
    const def = defineWriteHandler({
      name: "probe:granted-mixed",
      schema,
      access,
      escapeHatch: { reason: "probe", grants: ["systemIdentity", "crossTenantReads"] },
      handler: async (_event, ctx) => {
        expectTypeOf(ctx.crossTenantReads).toEqualTypeOf<CrossTenantReads>();
        return { isSuccess: true as const, data: {} };
      },
    });
    expectTypeOf(def.handler).toBeFunction();
  });

  test("an unsafeRaw grant keeps ctx.crossTenantReads optional", () => {
    const def = defineWriteHandler({
      name: "probe:unsafe-raw",
      schema,
      access,
      escapeHatch: { reason: "probe", grants: ["unsafeRaw"] },
      handler: async (_event, ctx) => {
        expectTypeOf(ctx.crossTenantReads).toEqualTypeOf<CrossTenantReads | undefined>();
        return { isSuccess: true as const, data: {} };
      },
    });
    expectTypeOf(def.handler).toBeFunction();
  });

  test("without escapeHatch ctx.crossTenantReads stays optional", () => {
    const def = defineWriteHandler({
      name: "probe:no-hatch",
      schema,
      access,
      handler: async (_event, ctx) => {
        expectTypeOf(ctx.crossTenantReads).toEqualTypeOf<CrossTenantReads | undefined>();
        return { isSuccess: true as const, data: {} };
      },
    });
    expectTypeOf(def.handler).toBeFunction();
  });

  test("a shared EscapeHatchDeclaration constant keeps the field optional", () => {
    const shared: EscapeHatchDeclaration = { reason: "probe", grants: ["crossTenantReads"] };
    const def = defineWriteHandler({
      name: "probe:shared",
      schema,
      access,
      escapeHatch: shared,
      handler: async (_event, ctx) => {
        expectTypeOf(ctx.crossTenantReads).toEqualTypeOf<CrossTenantReads | undefined>();
        return { isSuccess: true as const, data: {} };
      },
    });
    expectTypeOf(def.handler).toBeFunction();
  });

  test("explicit type arguments keep the field optional", () => {
    const def = defineWriteHandler<"probe:explicit", typeof schema, Record<string, never>>({
      name: "probe:explicit",
      schema,
      access,
      escapeHatch: { reason: "probe", grants: ["crossTenantReads"] },
      handler: async (_event, ctx) => {
        expectTypeOf(ctx.crossTenantReads).toEqualTypeOf<CrossTenantReads | undefined>();
        return { isSuccess: true as const, data: {} };
      },
    });
    expectTypeOf(def.handler).toBeFunction();
  });

  test("systemScope plus a crossTenantReads grant types both fields", () => {
    const def = defineWriteHandler({
      name: "probe:system-granted",
      schema,
      access,
      systemScope: true,
      escapeHatch: { reason: "probe", grants: ["crossTenantReads"] },
      handler: async (_event, ctx) => {
        expectTypeOf(ctx.systemDb).toEqualTypeOf<UncheckedSystemDb>();
        expectTypeOf(ctx.crossTenantReads).toEqualTypeOf<CrossTenantReads>();
        return { isSuccess: true as const, data: {} };
      },
    });
    expectTypeOf(def.handler).toBeFunction();
  });

  test("defineQueryHandler and definePagedQueryHandler type the granted field", () => {
    const query = defineQueryHandler({
      name: "probe:granted-query",
      schema,
      access,
      escapeHatch: { reason: "probe", grants: ["crossTenantReads"] },
      handler: async (_query, ctx) => {
        expectTypeOf(ctx.crossTenantReads).toEqualTypeOf<CrossTenantReads>();
        return {};
      },
    });
    const paged = definePagedQueryHandler({
      name: "probe:granted-paged",
      schema,
      access,
      escapeHatch: { reason: "probe", grants: ["crossTenantReads"] },
      handler: async (_query, ctx) => {
        expectTypeOf(ctx.crossTenantReads).toEqualTypeOf<CrossTenantReads>();
        return { rows: [], nextCursor: null };
      },
    });
    expectTypeOf(query.handler).toBeFunction();
    expectTypeOf(paged.handler).toBeFunction();
  });

  test("a handler annotated with the plain HandlerContext is still accepted", () => {
    const def = defineWriteHandler({
      name: "probe:annotated",
      schema,
      access,
      escapeHatch: { reason: "probe", grants: ["crossTenantReads"] },
      handler: async (_event, ctx: HandlerContext) => {
        expectTypeOf(ctx.crossTenantReads).toEqualTypeOf<CrossTenantReads | undefined>();
        return { isSuccess: true as const, data: {} };
      },
    });
    expectTypeOf(def.handler).toBeFunction();
  });

  test("an unknown grant name is a type error", () => {
    const def = defineWriteHandler({
      name: "probe:unknown-grant",
      schema,
      access,
      // @ts-expect-error unknown grant
      escapeHatch: { reason: "probe", grants: ["crossTenantRead"] },
      handler: async () => ({ isSuccess: true as const, data: {} }),
    });
    expectTypeOf(def.handler).toBeFunction();
  });

  test("GrantedHandlerContext maps only the crossTenantReads literal", () => {
    expectTypeOf<
      GrantedHandlerContext<HandlerContext, "crossTenantReads">["crossTenantReads"]
    >().toEqualTypeOf<CrossTenantReads>();
    expectTypeOf<
      GrantedHandlerContext<HandlerContext, EscapeHatchGrant>["crossTenantReads"]
    >().toEqualTypeOf<CrossTenantReads | undefined>();
  });
});
