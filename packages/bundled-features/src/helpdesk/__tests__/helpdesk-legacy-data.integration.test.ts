import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { buildEntityTable, createTenantDb, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  type SessionUser,
  SYSTEM_TENANT_ID,
  SYSTEM_USER_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { append } from "@cosmicdrift/kumiko-framework/event-store";
import { rebuildProjection } from "@cosmicdrift/kumiko-framework/pipeline";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { unsafeCreateEntityTable } from "@cosmicdrift/kumiko-testing/stack";
import { upsertPreference } from "../../delivery/upsert-preference.ts";
import { helpdeskRequestEntity } from "../entity.ts";
import {
  HELPDESK_FORMER_NOTIFICATION_NAMES,
  HelpdeskHandlers,
  HelpdeskQueries,
} from "../web/constants.ts";
import {
  loadReplies,
  loadRequests,
  mailsTo,
  postSubmit,
  seedAdmin,
  submitBody,
} from "./helpdesk-helpers.ts";
import {
  createHelpdeskTestStack,
  type HelpdeskTestStack,
  resetHelpdeskTestState,
} from "./helpdesk-test-stack.ts";

const FORMER_REQUEST_ENTITY = "contact-request";
const FORMER_REPLY_ENTITY = "contact-reply";

let ctx: HelpdeskTestStack;
let admin: SessionUser;

beforeAll(async () => {
  resetPiiSubjectKmsForTests();
  ctx = await createHelpdeskTestStack();
});

afterAll(async () => {
  ctx.telegram.stop();
  await ctx.stack.cleanup();
});

beforeEach(async () => {
  await resetHelpdeskTestState(ctx);
  admin = await seedAdmin(ctx.stack, "admin1@example.com");
});

describe("helpdesk keeps notification preferences stored under the contact names", () => {
  test("a former-name preference suppresses the new-request mail for that admin only", async () => {
    await seedAdmin(ctx.stack, "admin2@example.com");
    const [formerNewRequestName] = HELPDESK_FORMER_NOTIFICATION_NAMES.newRequest;

    const stored = await upsertPreference(
      createTenantDb({ db: ctx.stack.db, tenantId: admin.tenantId }),
      admin,
      {
        tenantId: admin.tenantId,
        userId: admin.id,
        notificationType: formerNewRequestName,
        channel: "email",
        enabled: false,
      },
    );
    expect(stored.isSuccess).toBe(true);

    const res = await postSubmit(ctx.stack, await submitBody(ctx.stack));
    expect(res.status).toBe(200);

    expect(mailsTo("admin1@example.com")).toHaveLength(0);
    expect(mailsTo("admin2@example.com")).toHaveLength(1);
  });
});

describe("helpdesk boots next to inert data from the contact feature", () => {
  async function seedFormerFeatureData(): Promise<void> {
    const formerRequestId = generateId();
    await append(ctx.stack.db, {
      aggregateId: formerRequestId,
      aggregateType: FORMER_REQUEST_ENTITY,
      tenantId: SYSTEM_TENANT_ID,
      expectedVersion: 0,
      type: `${FORMER_REQUEST_ENTITY}.created`,
      payload: { kind: "question", subject: "From before the rename", status: "open" },
      metadata: { userId: SYSTEM_USER_ID },
    });
    await append(ctx.stack.db, {
      aggregateId: generateId(),
      aggregateType: FORMER_REPLY_ENTITY,
      tenantId: SYSTEM_TENANT_ID,
      expectedVersion: 0,
      type: `${FORMER_REPLY_ENTITY}.created`,
      payload: { requestId: formerRequestId, message: "Answered before the rename" },
      metadata: { userId: SYSTEM_USER_ID },
    });
  }

  test("submit, list, detail, reply and mark-done work and a rebuild skips the former event types", async () => {
    // Table of the former entity name; DDL only, the events above stay the sole source of truth.
    const formerRequestEntity = { ...helpdeskRequestEntity, table: "read_contact_requests" };
    await unsafeCreateEntityTable(ctx.stack.db, formerRequestEntity, FORMER_REQUEST_ENTITY);
    const formerRequestTable = buildEntityTable(FORMER_REQUEST_ENTITY, formerRequestEntity);
    await seedFormerFeatureData();
    expect(await selectMany(ctx.stack.db, formerRequestTable, {})).toHaveLength(0);

    const res = await postSubmit(
      ctx.stack,
      await submitBody(ctx.stack, { email: "ada@example.com" }),
    );
    expect(res.status).toBe(200);
    const [row] = await loadRequests(ctx.stack);
    const requestId = String(row?.["id"]);

    const list = await ctx.stack.http.queryOk<{ rows: readonly { id: string }[]; total: number }>(
      HelpdeskQueries.requestList,
      {},
      admin,
    );
    expect(list.rows.map((r) => r.id)).toEqual([requestId]);

    const detail = await ctx.stack.http.queryOk<{ id: string }>(
      HelpdeskQueries.requestDetail,
      { id: requestId },
      admin,
    );
    expect(detail.id).toBe(requestId);

    await ctx.stack.http.writeOk(
      HelpdeskHandlers.reply,
      { requestId, message: "Use Settings > Export." },
      admin,
    );
    expect(await loadReplies(ctx.stack)).toHaveLength(1);

    await ctx.stack.http.writeOk(HelpdeskHandlers.markDone, { id: requestId }, admin);
    const [done] = await loadRequests(ctx.stack);
    expect(done?.["status"]).toBe("done");

    const projectionName = [...ctx.stack.registry.getAllProjections().keys()].find(
      (name) => name.startsWith("helpdesk:") && name.includes("helpdesk-request"),
    );
    if (projectionName === undefined) throw new Error("helpdesk request projection not registered");
    await rebuildProjection(projectionName, { db: ctx.stack.db, registry: ctx.stack.registry });

    const rebuilt = await loadRequests(ctx.stack);
    expect(rebuilt.map((r) => r["id"])).toEqual([requestId]);
    expect(rebuilt[0]?.["status"]).toBe("done");
    expect(await selectMany(ctx.stack.db, formerRequestTable, {})).toHaveLength(0);
  });
});
