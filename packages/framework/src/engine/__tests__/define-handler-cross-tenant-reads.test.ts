import { describe, expect, test } from "bun:test";
import type { HandlerContext } from "@cosmicdrift/kumiko-types/handlers";
import type { TenantId } from "@cosmicdrift/kumiko-types/identifiers";
import type { CrossTenantReads } from "@cosmicdrift/kumiko-types/tenant-db-types";
import * as z from "zod";
import { runAsAgentToolCallEntry } from "../../api/request-context.ts";
import { createSystemDbView, type TenantDb } from "../../db/index.ts";
import { AccessDeniedError, InternalError } from "../../errors/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import {
  definePagedQueryHandler,
  defineQueryHandler,
  defineWriteHandler,
  isPagedQueryHandler,
} from "../define-handler.ts";
import { stepsPipeline } from "../pipeline.ts";
import { buildMinimalCtx } from "./_pipeline-test-utils.ts";

const notRead = async (): Promise<never> => {
  throw new Error("these tests never read through the fake crossTenantReads");
};
const fakeReads: CrossTenantReads = {
  selectMany: notRead,
  fetchOne: notRead,
  count: notRead,
  aggregate: notRead,
};

// Only .tenantId is read by createSystemDbView.
function fakeTenantDb(): TenantDb {
  return { tenantId: "tenant-a" as TenantId, mode: "system" } as unknown as TenantDb;
}

// The member check reads ctx.user, so every ctx carries one (buildMinimalCtx is empty).
function ctxWith(
  fields: Partial<Pick<HandlerContext, "crossTenantReads" | "systemDb" | "user">>,
): HandlerContext {
  return { ...buildMinimalCtx(), user: TestUsers.admin, ...fields };
}

const schema = z.object({});
const access = { roles: ["SystemAdmin"] };
const grant = { reason: "probe", grants: ["crossTenantReads"] } as const;
const writeEvent = { type: "probe:write", payload: {}, user: TestUsers.admin };
const queryEvent = { type: "probe:query", payload: {}, user: TestUsers.admin };

describe("defineWriteHandler crossTenantReads grant", () => {
  test("throws InternalError naming the handler when the field is missing", async () => {
    const def = defineWriteHandler({
      name: "probe:reads-write",
      schema,
      access,
      escapeHatch: grant,
      handler: async () => ({ isSuccess: true as const, data: {} }),
    });
    await expect(def.handler(writeEvent, ctxWith({}))).rejects.toThrow(InternalError);
    await expect(def.handler(writeEvent, ctxWith({}))).rejects.toThrow(/probe:reads-write/);
  });

  test("hands the same ctx to the author handler when the field is present", async () => {
    let seen: unknown;
    const def = defineWriteHandler({
      name: "probe:reads-write-ok",
      schema,
      access,
      escapeHatch: grant,
      handler: async (_event, ctx) => {
        seen = ctx;
        return { isSuccess: true as const, data: { ok: true } };
      },
    });
    const ctx = ctxWith({ crossTenantReads: fakeReads });
    const result = await def.handler(writeEvent, ctx);
    expect(seen).toBe(ctx);
    expect(result).toEqual({ isSuccess: true, data: { ok: true } });
  });

  test("an unsafeRaw grant adds no wrapper", () => {
    const authorHandler = async () => ({ isSuccess: true as const, data: {} });
    const def = defineWriteHandler({
      name: "probe:reads-unsafe-raw",
      schema,
      access,
      escapeHatch: { reason: "probe", grants: ["unsafeRaw"] },
      handler: authorHandler,
    });
    expect(def.handler).toBe(authorHandler);
  });

  test("a systemIdentity grant adds no wrapper", () => {
    const authorHandler = async () => ({ isSuccess: true as const, data: {} });
    const def = defineWriteHandler({
      name: "probe:reads-system-identity",
      schema,
      access,
      escapeHatch: { reason: "probe", grants: ["systemIdentity"] },
      handler: authorHandler,
    });
    expect(def.handler).toBe(authorHandler);
  });

  test("with systemScope both fields are checked, systemDb first", async () => {
    let seen: unknown;
    const def = defineWriteHandler({
      name: "probe:reads-system-write",
      schema,
      access,
      systemScope: true,
      escapeHatch: grant,
      handler: async (_event, ctx) => {
        seen = ctx;
        return { isSuccess: true as const, data: {} };
      },
    });
    const systemDb = createSystemDbView(fakeTenantDb());

    const withoutReads = ctxWith({ systemDb });
    await expect(def.handler(writeEvent, withoutReads)).rejects.toThrow(/crossTenantReads/);
    await expect(def.handler(writeEvent, withoutReads)).rejects.toThrow(/probe:reads-system-write/);

    const withoutBoth = ctxWith({});
    await expect(def.handler(writeEvent, withoutBoth)).rejects.toThrow(/systemScope/);

    const complete = ctxWith({ systemDb, crossTenantReads: fakeReads });
    await def.handler(writeEvent, complete);
    expect(seen).toBe(complete);
  });

  test("perform form throws InternalError when the field is missing", async () => {
    const def = defineWriteHandler({
      name: "probe:reads-perform",
      schema,
      access,
      escapeHatch: grant,
      perform: stepsPipeline<Record<string, never>, { ok: true }>(({ r }) => [
        r.step.return({ isSuccess: true as const, data: { ok: true } }),
      ]),
    });
    await expect(def.handler(writeEvent, ctxWith({}))).rejects.toThrow(InternalError);
  });
});

describe("defineQueryHandler crossTenantReads grant", () => {
  const def = defineQueryHandler({
    name: "probe:reads-query",
    schema,
    access,
    escapeHatch: grant,
    handler: async () => ({}),
  });

  test("inside an agent tool call a missing field is access_denied", async () => {
    const call = runAsAgentToolCallEntry(() => def.handler(queryEvent, ctxWith({})));
    await expect(call).rejects.toMatchObject({ code: "access_denied" });
    await expect(
      runAsAgentToolCallEntry(() => def.handler(queryEvent, ctxWith({}))),
    ).rejects.toThrow(/probe:reads-query/);
  });

  test("a member-resolution principal without the field is access_denied", async () => {
    const ctx = ctxWith({ user: { ...TestUsers.admin, origin: "member-resolution" } });
    await expect(def.handler(queryEvent, ctx)).rejects.toThrow(AccessDeniedError);
  });

  test("hands the same ctx to the author handler when the field is present", async () => {
    let seen: unknown;
    const present = defineQueryHandler({
      name: "probe:reads-query-ok",
      schema,
      access,
      escapeHatch: grant,
      handler: async (_query, ctx) => {
        seen = ctx;
        return {};
      },
    });
    const ctx = ctxWith({ crossTenantReads: fakeReads });
    await present.handler(queryEvent, ctx);
    expect(seen).toBe(ctx);
  });
});

describe("definePagedQueryHandler crossTenantReads grant", () => {
  test("throws naming the handler and keeps the paged brand", async () => {
    const def = definePagedQueryHandler({
      name: "probe:reads-paged",
      schema,
      access,
      escapeHatch: grant,
      handler: async () => ({ rows: [], nextCursor: null }),
    });
    expect(isPagedQueryHandler(def)).toBe(true);
    await expect(def.handler(queryEvent, ctxWith({}))).rejects.toThrow(/probe:reads-paged/);
  });
});
