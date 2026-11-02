import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
  fetchOne,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import { type SessionUser, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests, resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import { unsafeCreateEntityTable } from "@cosmicdrift/kumiko-testing/stack";
import { USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { runForgetCleanup } from "../../user-data-rights/run-forget-cleanup.ts";
import { runUserExport } from "../../user-data-rights/run-user-export.ts";
import { helpdeskReplyEntity, helpdeskRequestEntity } from "../entity.ts";
import { seedReporter } from "./helpdesk-helpers.ts";
import {
  createHelpdeskTestStack,
  type HelpdeskTestStack,
  resetHelpdeskTestState,
} from "./helpdesk-test-stack.ts";

// The former contact feature's definitions, rebuilt here to write rows the way it did.
const FORMER_REQUEST_ENTITY = "contact-request";
const FORMER_REPLY_ENTITY = "contact-reply";
const formerRequestEntity = { ...helpdeskRequestEntity, table: "read_contact_requests" };
const formerReplyEntity = { ...helpdeskReplyEntity, table: "read_contact_replies" };
const formerRequestTable = buildEntityTable(FORMER_REQUEST_ENTITY, formerRequestEntity);
const formerReplyTable = buildEntityTable(FORMER_REPLY_ENTITY, formerReplyEntity);
const formerRequestExecutor = createEventStoreExecutor(formerRequestTable, formerRequestEntity, {
  entityName: FORMER_REQUEST_ENTITY,
});
const formerReplyExecutor = createEventStoreExecutor(formerReplyTable, formerReplyEntity, {
  entityName: FORMER_REPLY_ENTITY,
});
const userExecutor = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

const REPORTER_EMAIL = "gone@example.com";

let ctx: HelpdeskTestStack;
let reporter: SessionUser;

function systemDb() {
  return createTenantDb({
    db: ctx.stack.db,
    tenantId: SYSTEM_TENANT_ID,
    mode: "system",
    reason: "test writes platform-wide former contact rows",
  });
}

async function createFormerRequest(
  fields: { readonly reporterUserId?: string; readonly email: string },
  subject: string,
): Promise<string> {
  const created = await formerRequestExecutor.create(
    {
      kind: "question",
      status: "open",
      source: "website",
      subject,
      message: `${subject} message`,
      name: "Rita Reporter",
      submittedAt: Temporal.Now.instant(),
      ...fields,
    },
    TestUsers.systemAdmin,
    systemDb(),
  );
  if (!created.isSuccess) throw new Error(`former request create failed: ${created.error.code}`);
  return String(created.data["id"]);
}

async function createFormerReply(requestId: string): Promise<void> {
  const created = await formerReplyExecutor.create(
    {
      requestId,
      message: "Answered before the rename",
      authorUserId: TestUsers.systemAdmin.id,
      authorName: "Support",
      channels: "email",
      sentAt: Temporal.Now.instant(),
    },
    TestUsers.systemAdmin,
    systemDb(),
  );
  if (!created.isSuccess) throw new Error(`former reply create failed: ${created.error.code}`);
}

async function formerSubjects(): Promise<readonly string[]> {
  const rows = await selectMany<{ subject: string }>(ctx.stack.db, formerRequestTable, {});
  return rows.map((row) => row.subject).sort();
}

async function requestDeletion(userId: string): Promise<void> {
  const row = await fetchOne(ctx.stack.db, userTable, { id: userId });
  if (!row) throw new Error("user missing");
  const marked = await userExecutor.update(
    {
      id: userId,
      version: Number(row["version"]),
      changes: {
        status: USER_STATUS.DeletionRequested,
        gracePeriodEnd: Temporal.Now.instant().subtract({ minutes: 1 }),
      },
    },
    TestUsers.systemAdmin,
    systemDb(),
  );
  expect(marked.isSuccess).toBe(true);
}

beforeAll(async () => {
  resetPiiSubjectKmsForTests();
  ctx = await createHelpdeskTestStack();
  await unsafeCreateEntityTable(ctx.stack.db, formerRequestEntity, FORMER_REQUEST_ENTITY);
  await unsafeCreateEntityTable(ctx.stack.db, formerReplyEntity, FORMER_REPLY_ENTITY);
});

afterAll(async () => {
  ctx.telegram.stop();
  await ctx.stack.cleanup();
});

beforeEach(async () => {
  await resetHelpdeskTestState(ctx);
  await resetTestTables(ctx.stack.db, [formerRequestTable, formerReplyTable]);
  reporter = await seedReporter(ctx.stack, REPORTER_EMAIL);
});

describe("requests stored under the former contact names are covered by user data rights", () => {
  test("the export contains the former requests and their replies", async () => {
    const byUserId = await createFormerRequest(
      { reporterUserId: reporter.id, email: "other@example.com" },
      "Filed while signed in",
    );
    await createFormerRequest({ email: REPORTER_EMAIL }, "Filed anonymously");
    await createFormerReply(byUserId);
    await createFormerRequest({ email: "stranger@example.com" }, "Someone else");

    const bundle = await runUserExport({
      db: ctx.stack.db,
      registry: ctx.stack.registry,
      userId: reporter.id,
      now: Temporal.Now.instant(),
    });

    const snippet = bundle.tenants
      .flatMap((section) => section.entities)
      .find((entity) => entity.entity === FORMER_REQUEST_ENTITY);
    expect(snippet?.rows.map((row) => row["subject"]).sort()).toEqual([
      "Filed anonymously",
      "Filed while signed in",
    ]);
    const signedIn = snippet?.rows.find((row) => row["subject"] === "Filed while signed in");
    expect(JSON.stringify(signedIn?.["replies"])).toContain("Answered before the rename");
  });

  test("forgetting the user removes the former requests and replies and keeps foreign ones", async () => {
    const requestId = await createFormerRequest(
      { reporterUserId: reporter.id, email: "other@example.com" },
      "Filed while signed in",
    );
    await createFormerRequest({ email: REPORTER_EMAIL }, "Filed anonymously");
    await createFormerReply(requestId);
    await createFormerRequest({ email: "stranger@example.com" }, "Someone else");

    await requestDeletion(reporter.id);
    const result = await runForgetCleanup({
      db: ctx.stack.db,
      registry: ctx.stack.registry,
      now: Temporal.Now.instant(),
      buildStorageProvider: ctx.buildStorageProvider,
    });

    expect(result.errors).toHaveLength(0);
    expect(await formerSubjects()).toEqual(["Someone else"]);
    expect(await selectMany(ctx.stack.db, formerReplyTable, {})).toHaveLength(0);
  });
});
