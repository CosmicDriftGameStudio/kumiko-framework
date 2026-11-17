import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createConfigFeature } from "../../config/index.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { createUserFeature } from "../../user/index.ts";
import { recordAccess } from "../access-log.ts";
import { createAuditFeature } from "../feature.ts";
import { AuditQueries } from "../web/constants.ts";

const docPayload = z.object({ docId: z.string() });

const accessProbeFeature = defineFeature("accessprobe", (r) => {
  r.queryHandler({
    name: "open",
    schema: docPayload,
    access: { roles: ["User", "TenantAdmin"] },
    handler: async (query, ctx) => {
      await recordAccess(ctx, {
        subjectType: "probe-doc",
        subjectId: query.payload.docId,
        action: "opened",
        details: { source: "probe" },
      });
      return { ok: true };
    },
  });
  r.writeHandler({
    name: "open-then-fail",
    schema: docPayload,
    access: { roles: ["User", "TenantAdmin"] },
    handler: async (event, ctx) => {
      await recordAccess(ctx, {
        subjectType: "probe-doc",
        subjectId: event.payload.docId,
        action: "action-failed",
      });
      throw new UnprocessableError("probe handler fails after recording the access");
    },
  });
});

const accessProbeSystemFeature = defineFeature("accessprobesys", (r) => {
  r.systemScope();
  r.queryHandler({
    name: "open",
    schema: docPayload,
    access: { roles: ["User", "TenantAdmin"] },
    handler: async (query, ctx) => {
      await recordAccess(ctx, {
        subjectType: "probe-doc",
        subjectId: query.payload.docId,
        action: "opened-system",
      });
      return { ok: true };
    },
  });
});

type AccessLogResult = {
  readonly rows: readonly {
    readonly id: string;
    readonly actorId: string;
    readonly subjectType: string;
    readonly subjectId: string;
    readonly action: string;
    readonly details: Record<string, string | number | boolean>;
  }[];
  readonly nextBefore: string | null;
};

const adminA = createTestUser({ id: 21, tenantId: testTenantId(21), roles: ["TenantAdmin"] });
const plainUser = createTestUser({ id: 23, tenantId: testTenantId(21), roles: ["User"] });
const adminB = createTestUser({ id: 22, tenantId: testTenantId(22), roles: ["TenantAdmin"] });

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createUserFeature(),
      createAuditFeature(),
      accessProbeFeature,
      accessProbeSystemFeature,
    ],
  });
});

afterAll(async () => {
  await stack.cleanup();
});

function readLog(filter: Record<string, unknown>, user = adminA): Promise<AccessLogResult> {
  return stack.http.queryOk<AccessLogResult>(AuditQueries.accessLog, filter, user);
}

describe("access log", () => {
  test("a query handler records the access", async () => {
    const docId = generateId();
    const res = await stack.http.query("accessprobe:query:open", { docId }, plainUser);
    expect(res.status).toBe(200);

    const { rows } = await readLog({ subjectId: docId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: plainUser.id,
      subjectType: "probe-doc",
      subjectId: docId,
      action: "opened",
      details: { source: "probe" },
    });
  });

  test("the entry survives a handler that fails after recording", async () => {
    const docId = generateId();
    const res = await stack.http.write("accessprobe:write:open-then-fail", { docId }, plainUser);
    expect(res.ok).toBe(false);

    const { rows } = await readLog({ subjectId: docId });
    expect(rows.map((r) => r.action)).toEqual(["action-failed"]);
  });

  test("a systemScope handler records in the tenant of the user", async () => {
    const docId = generateId();
    const res = await stack.http.query("accessprobesys:query:open", { docId }, plainUser);
    expect(res.status).toBe(200);

    const { rows } = await readLog({ subjectId: docId });
    expect(rows.map((r) => r.action)).toEqual(["opened-system"]);
  });

  test("another tenant's admin sees no rows", async () => {
    const docId = generateId();
    await stack.http.query("accessprobe:query:open", { docId }, plainUser);

    expect((await readLog({ subjectId: docId }, adminB)).rows).toHaveLength(0);
  });

  test("a user without an admin role is forbidden", async () => {
    const res = await stack.http.query(AuditQueries.accessLog, {}, plainUser);
    expect(res.status).toBe(403);
  });

  test("pages newest first with a cursor", async () => {
    const docId = generateId();
    for (let i = 0; i < 3; i++) {
      await stack.http.query("accessprobe:query:open", { docId }, plainUser);
    }
    const firstPage = await readLog({ subjectId: docId, limit: 2 });
    expect(firstPage.rows).toHaveLength(2);
    expect(firstPage.nextBefore).toBe(firstPage.rows[1]?.id ?? null);

    const secondPage = await readLog({
      subjectId: docId,
      limit: 2,
      before: firstPage.nextBefore ?? undefined,
    });
    expect(secondPage.rows).toHaveLength(1);
    const ids = [...firstPage.rows, ...secondPage.rows].map((r) => r.id);
    expect(ids).toEqual([...ids].sort().reverse());
  });
});
