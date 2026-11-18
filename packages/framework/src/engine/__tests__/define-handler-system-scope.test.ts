import { describe, expect, test } from "bun:test";
import type { HandlerContext } from "@cosmicdrift/kumiko-types/handlers";
import type { TenantId } from "@cosmicdrift/kumiko-types/identifiers";
import * as z from "zod";
import { createSystemDbView, type TenantDb } from "../../db/index.ts";
import { InternalError } from "../../errors/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import {
  definePagedQueryHandler,
  defineQueryHandler,
  defineWriteHandler,
  isPagedQueryHandler,
} from "../define-handler.ts";
import { stepsPipeline } from "../pipeline.ts";
import { buildMinimalCtx } from "./_pipeline-test-utils.ts";

// Only .tenantId is read by createSystemDbView.
function fakeTenantDb(): TenantDb {
  return { tenantId: "tenant-a" as TenantId, mode: "system" } as unknown as TenantDb;
}

function ctxWithSystemDb(): HandlerContext {
  return { ...buildMinimalCtx(), systemDb: createSystemDbView(fakeTenantDb()) };
}

const schema = z.object({});
const access = { roles: ["SystemAdmin"] };
const writeEvent = { type: "probe:write", payload: {}, user: TestUsers.admin };
const queryEvent = { type: "probe:query", payload: {}, user: TestUsers.admin };

describe("defineWriteHandler excludedFields", () => {
  test("a hand-written handler's excludedFields reach the definition", () => {
    const def = defineWriteHandler({
      name: "probe:excluded",
      schema,
      access,
      excludedFields: ["internalNote"],
      handler: async () => ({ isSuccess: true as const, data: {} }),
    });
    expect(def.excludedFields).toEqual(["internalNote"]);
  });

  test("excludedFields stays absent when not declared", () => {
    const def = defineWriteHandler({
      name: "probe:not-excluded",
      schema,
      access,
      handler: async () => ({ isSuccess: true as const, data: {} }),
    });
    expect(def.excludedFields).toBeUndefined();
  });
});

describe("defineWriteHandler systemScope marker", () => {
  test("throws InternalError naming the handler when ctx.systemDb is missing", async () => {
    const def = defineWriteHandler({
      name: "probe:needs-system-db",
      schema,
      access,
      systemScope: true,
      handler: async () => ({ isSuccess: true as const, data: {} }),
    });
    await expect(def.handler(writeEvent, buildMinimalCtx())).rejects.toThrow(InternalError);
    await expect(def.handler(writeEvent, buildMinimalCtx())).rejects.toThrow(
      /probe:needs-system-db/,
    );
  });

  test("hands the same ctx object to the author handler when systemDb is present", async () => {
    let seen: unknown;
    const def = defineWriteHandler({
      name: "probe:with-system-db",
      schema,
      access,
      systemScope: true,
      handler: async (_event, ctx) => {
        seen = ctx;
        return { isSuccess: true as const, data: {} };
      },
    });
    const ctx = ctxWithSystemDb();
    await def.handler(writeEvent, ctx);
    expect(seen).toBe(ctx);
    expect(def.systemScope).toBe(true);
  });

  test("perform form with the marker throws without ctx.systemDb", async () => {
    const def = defineWriteHandler({
      name: "probe:perform-system",
      schema,
      access,
      systemScope: true,
      perform: stepsPipeline<Record<string, never>, { ok: true }>(({ r }) => [
        r.step.return({ isSuccess: true as const, data: { ok: true } }),
      ]),
    });
    await expect(def.handler(writeEvent, buildMinimalCtx())).rejects.toThrow(InternalError);
    await expect(def.handler(writeEvent, buildMinimalCtx())).rejects.toThrow(
      /probe:perform-system/,
    );
  });

  test("without the marker the author function is used as is and no systemScope key is set", () => {
    const authorHandler = async () => ({ isSuccess: true as const, data: {} });
    const def = defineWriteHandler({
      name: "probe:plain",
      schema,
      access,
      handler: authorHandler,
    });
    expect(def.handler).toBe(authorHandler);
    expect("systemScope" in def).toBe(false);
  });
});

describe("defineQueryHandler systemScope marker", () => {
  test("throws without ctx.systemDb and passes the ctx through with it", async () => {
    let seen: unknown;
    const def = defineQueryHandler({
      name: "probe:system-query",
      schema,
      access,
      systemScope: true,
      handler: async (_query, ctx) => {
        seen = ctx;
        return {};
      },
    });
    await expect(def.handler(queryEvent, buildMinimalCtx())).rejects.toThrow(/probe:system-query/);
    const ctx = ctxWithSystemDb();
    await def.handler(queryEvent, ctx);
    expect(seen).toBe(ctx);
    expect(def.systemScope).toBe(true);
  });

  test("without the marker the author function is used as is", () => {
    const authorHandler = async () => ({});
    const def = defineQueryHandler({
      name: "probe:plain-query",
      schema,
      access,
      handler: authorHandler,
    });
    expect(def.handler).toBe(authorHandler);
    expect("systemScope" in def).toBe(false);
  });
});

describe("definePagedQueryHandler systemScope marker", () => {
  test("throws without ctx.systemDb and keeps the paged brand", async () => {
    const def = definePagedQueryHandler({
      name: "probe:system-paged",
      schema,
      access,
      systemScope: true,
      handler: async () => ({ rows: [], nextCursor: null }),
    });
    expect(isPagedQueryHandler(def)).toBe(true);
    await expect(def.handler(queryEvent, buildMinimalCtx())).rejects.toThrow(/probe:system-paged/);
  });
});
