// Production form: apps dropped read_contact_requests / read_contact_replies, only the contact-request /
// contact-reply events remain. The legacy events are written through executors bound to scratch tables,
// so the read tables the code used to query never exist in this database.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
  fetchOne,
} from "@cosmicdrift/kumiko-framework/db";
import { type SessionUser, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { isStreamArchived } from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  createManualClock,
  resetPiiSubjectKmsForTests,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import { unsafeCreateEntityTable } from "@cosmicdrift/kumiko-testing/stack";
import { noteEntryExecutor, noteEntryTable } from "../../notes-history/executor.ts";
import { NotesHistoryHandlers, NotesHistoryQueries } from "../../notes-history/web/constants.ts";
import { decryptStoredPii } from "../../shared/index.ts";
import { USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { runForgetCleanup } from "../../user-data-rights/run-forget-cleanup.ts";
import { runUserExport } from "../../user-data-rights/run-user-export.ts";
import { helpdeskReplyEntity, helpdeskRequestEntity } from "../entity.ts";
import { HELPDESK_REQUEST_ENTITY } from "../web/constants.ts";
import {
  loadRequests,
  postSubmit,
  seedAdmin,
  seedReporter,
  submitBody,
} from "./helpdesk-helpers.ts";
import {
  createHelpdeskTestStack,
  type HelpdeskTestStack,
  resetHelpdeskTestState,
} from "./helpdesk-test-stack.ts";

const LEGACY_REQUEST = "contact-request";
const LEGACY_REPLY = "contact-reply";
const LEGACY_RETENTION_JOB = "helpdesk:job:legacy-contact-retention";
const DAY_HOURS = 24;
const REPORTER_EMAIL = "gone@example.com";

const scratchRequestEntity = { ...helpdeskRequestEntity, table: "scratch_contact_requests" };
const scratchReplyEntity = { ...helpdeskReplyEntity, table: "scratch_contact_replies" };
const scratchRequestTable = buildEntityTable(LEGACY_REQUEST, scratchRequestEntity);
const scratchReplyTable = buildEntityTable(LEGACY_REPLY, scratchReplyEntity);
const legacyRequestExecutor = createEventStoreExecutor(scratchRequestTable, scratchRequestEntity, {
  entityName: LEGACY_REQUEST,
});
const legacyReplyExecutor = createEventStoreExecutor(scratchReplyTable, scratchReplyEntity, {
  entityName: LEGACY_REPLY,
});
const userExecutor = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

const clockStart = getTemporal().Now.instant();
const clock = createManualClock(clockStart);

let ctx: HelpdeskTestStack;
let reporter: SessionUser;

function systemDb() {
  return createTenantDb({
    db: ctx.stack.db,
    tenantId: SYSTEM_TENANT_ID,
    mode: "system",
    reason: "test writes platform-wide legacy contact events",
  });
}

async function writeLegacyRequest(
  fields: { readonly reporterUserId?: string; readonly email: string },
  subject: string,
  submittedAt = clockStart,
): Promise<string> {
  const created = await legacyRequestExecutor.create(
    {
      kind: "question",
      status: "open",
      source: "website",
      subject,
      message: `${subject} message`,
      name: "Rita Reporter",
      submittedAt,
      ...fields,
    },
    TestUsers.systemAdmin,
    systemDb(),
  );
  if (!created.isSuccess) throw new Error(`legacy request create failed: ${created.error.code}`);
  return String(created.data["id"]);
}

async function writeLegacyReply(requestId: string, sentAt = clockStart): Promise<void> {
  const created = await legacyReplyExecutor.create(
    {
      requestId,
      message: "Answered before the rename",
      authorUserId: TestUsers.systemAdmin.id,
      authorName: "Support",
      channels: "email",
      sentAt,
    },
    TestUsers.systemAdmin,
    systemDb(),
  );
  if (!created.isSuccess) throw new Error(`legacy reply create failed: ${created.error.code}`);
}

async function legacyExportRows() {
  const bundle = await runUserExport({
    db: ctx.stack.db,
    registry: ctx.stack.registry,
    userId: reporter.id,
    now: clock.now(),
  });
  const snippet = bundle.tenants
    .flatMap((section) => section.entities)
    .find((entity) => entity.entity === LEGACY_REQUEST);
  return snippet?.rows ?? [];
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
        gracePeriodEnd: clock.now().subtract({ minutes: 1 }),
      },
    },
    TestUsers.systemAdmin,
    systemDb(),
  );
  expect(marked.isSuccess).toBe(true);
}

async function forgetAll(): Promise<void> {
  const result = await runForgetCleanup({
    db: ctx.stack.db,
    registry: ctx.stack.registry,
    now: clock.now(),
    buildStorageProvider: ctx.buildStorageProvider,
  });
  expect(result.errors).toHaveLength(0);
}

async function isArchived(aggregateId: string): Promise<boolean> {
  return isStreamArchived(ctx.stack.db, SYSTEM_TENANT_ID, aggregateId);
}

async function operator(): Promise<SessionUser> {
  const admin = await seedAdmin(ctx.stack, `operator-${crypto.randomUUID()}@example.com`);
  return { ...admin, roles: ["SystemAdmin", "TenantAdmin"] };
}

async function addNote(entityType: string, entityId: string, body: string): Promise<void> {
  await ctx.stack.http.writeOk(
    NotesHistoryHandlers.addNote,
    { entityType, entityId, body },
    await operator(),
  );
}

async function noteBodies(entityType: string, entityId: string): Promise<readonly string[]> {
  const result = await ctx.stack.http.queryOk<{ rows: readonly { body: string }[] }>(
    NotesHistoryQueries.noteList,
    {
      filters: [
        { field: "entityType", op: "eq", value: entityType },
        { field: "entityId", op: "eq", value: entityId },
      ],
    },
    await operator(),
  );
  return result.rows.map((row) => row.body);
}

// The add-note handler refuses hosts that are no longer registered entities, so notes written while
// the contact feature existed are seeded through the executor.
async function seedLegacyNote(entityId: string, body: string): Promise<string> {
  const author = await operator();
  const created = await noteEntryExecutor.create(
    { entityType: LEGACY_REQUEST, entityId, body, authorId: author.id, authorName: null },
    author,
    systemDb(),
  );
  if (!created.isSuccess) throw new Error(`legacy note create failed: ${created.error.code}`);
  return String(created.data.id);
}

async function storedNoteBody(noteId: string): Promise<string> {
  const row = await fetchOne<{ body: string }>(ctx.stack.db, noteEntryTable, { id: noteId });
  if (!row) throw new Error("note row missing");
  return decryptStoredPii(row.body, "body", "legacy-contact-test");
}

beforeAll(async () => {
  resetPiiSubjectKmsForTests();
  ctx = await createHelpdeskTestStack({}, { clock, jobConsumer: true });
  await unsafeCreateEntityTable(ctx.stack.db, scratchRequestEntity, LEGACY_REQUEST);
  await unsafeCreateEntityTable(ctx.stack.db, scratchReplyEntity, LEGACY_REPLY);
});

afterAll(async () => {
  ctx.telegram.stop();
  await ctx.stack.cleanup();
});

beforeEach(async () => {
  resetPiiSubjectKmsForTests();
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  configureBlindIndexKey(Buffer.alloc(32, 7).toString("base64"));
  clock.set(clockStart);
  await resetHelpdeskTestState(ctx);
  await resetTestTables(ctx.stack.db, [scratchRequestTable, scratchReplyTable]);
  reporter = await seedReporter(ctx.stack, REPORTER_EMAIL);
});

describe("legacy contact data without the read tables", () => {
  test("the export returns the legacy requests and replies of the user", async () => {
    const byUserId = await writeLegacyRequest(
      { reporterUserId: reporter.id, email: "other@example.com" },
      "Filed while signed in",
    );
    await writeLegacyReply(byUserId);
    await writeLegacyRequest({ email: "stranger@example.com" }, "Someone else");

    const rows = await legacyExportRows();

    expect(rows.map((row) => row["subject"])).toEqual(["Filed while signed in"]);
    expect(JSON.stringify(rows[0]?.["replies"])).toContain("Answered before the rename");
  });

  test("forgetting the user shreds and archives the legacy streams and keeps foreign ones", async () => {
    const requestId = await writeLegacyRequest(
      { reporterUserId: reporter.id, email: "other@example.com" },
      "Filed while signed in",
    );
    await writeLegacyReply(requestId);
    const strangerId = await writeLegacyRequest({ email: "stranger@example.com" }, "Someone else");

    await requestDeletion(reporter.id);
    await forgetAll();

    expect(await isArchived(requestId)).toBe(true);
    expect(await isArchived(strangerId)).toBe(false);
    expect(await legacyExportRows()).toEqual([]);
  });

  test("an anonymous request matched by the verified email is deleted", async () => {
    const anonymousId = await writeLegacyRequest({ email: REPORTER_EMAIL }, "Filed anonymously");

    expect(await legacyExportRows()).toHaveLength(1);
    await requestDeletion(reporter.id);
    await forgetAll();

    expect(await isArchived(anonymousId)).toBe(true);
    expect(await legacyExportRows()).toEqual([]);
  });

  test("a note on a deleted legacy request loses its body", async () => {
    const requestId = await writeLegacyRequest(
      { reporterUserId: reporter.id, email: "other@example.com" },
      "Filed while signed in",
    );
    const noteId = await seedLegacyNote(requestId, "Call back on Monday.");
    expect(await storedNoteBody(noteId)).toBe("Call back on Monday.");

    await requestDeletion(reporter.id);
    await forgetAll();

    expect(await storedNoteBody(noteId)).toBe(PII_ERASED_SENTINEL);
  });

  test("the retention job removes only legacy aggregates older than the keep period", async () => {
    const oldAt = clockStart.subtract({ hours: 800 * DAY_HOURS });
    const oldId = await writeLegacyRequest(
      { reporterUserId: reporter.id, email: "old@example.com" },
      "Old request",
      oldAt,
    );
    await writeLegacyReply(oldId, oldAt);
    const freshId = await writeLegacyRequest(
      { reporterUserId: reporter.id, email: "fresh@example.com" },
      "Fresh request",
    );
    const noteId = await seedLegacyNote(oldId, "Old note body.");

    await ctx.stack.jobRunner?.dispatch(LEGACY_RETENTION_JOB, {});
    await ctx.stack.drainJobs();

    expect(await isArchived(oldId)).toBe(true);
    expect(await isArchived(freshId)).toBe(false);
    expect((await legacyExportRows()).map((row) => row["subject"])).toEqual(["Fresh request"]);
    expect(await storedNoteBody(noteId)).toBe(PII_ERASED_SENTINEL);
  });
});

describe("helpdesk requests", () => {
  test("forgetting the user erases the notes on their helpdesk request", async () => {
    const res = await postSubmit(ctx.stack, await submitBody(ctx.stack, { email: REPORTER_EMAIL }));
    expect(res.status).toBe(200);
    const [request] = await loadRequests(ctx.stack);
    const requestId = String(request?.["id"]);
    await addNote(HELPDESK_REQUEST_ENTITY, requestId, "Escalate to billing.");
    expect(await noteBodies(HELPDESK_REQUEST_ENTITY, requestId)).toEqual(["Escalate to billing."]);

    await requestDeletion(reporter.id);
    await forgetAll();

    expect(await loadRequests(ctx.stack)).toHaveLength(0);
    expect(await noteBodies(HELPDESK_REQUEST_ENTITY, requestId)).not.toContain(
      "Escalate to billing.",
    );
  });
});
