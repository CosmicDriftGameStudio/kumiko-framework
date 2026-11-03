import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { NotesHistoryHandlers, NotesHistoryQueries } from "../../notes-history/web/constants.ts";
import { HELPDESK_REQUEST_ENTITY } from "../web/constants.ts";
import {
  loadRequests,
  postSubmit,
  seedReporter,
  seedRoamingAdmin,
  submitBody,
} from "./helpdesk-helpers.ts";
import {
  createHelpdeskTestStack,
  type HelpdeskTestStack,
  resetHelpdeskTestState,
} from "./helpdesk-test-stack.ts";

let ctx: HelpdeskTestStack;

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
});

async function submitAnonymous(email: string): Promise<string> {
  const res = await postSubmit(ctx.stack, await submitBody(ctx.stack, { email }));
  expect(res.status).toBe(200);
  const row = (await loadRequests(ctx.stack)).find((r) => r["email"] === email);
  if (!row) throw new Error("request missing");
  return String(row["id"]);
}

type NoteRow = { readonly body: string; readonly entityId: string };

async function notesOf(requestId: string, as: SessionUser): Promise<readonly string[]> {
  const result = await ctx.stack.http.queryOk<{ rows: readonly NoteRow[] }>(
    NotesHistoryQueries.noteList,
    {
      filters: [
        { field: "entityType", op: "eq", value: HELPDESK_REQUEST_ENTITY },
        { field: "entityId", op: "eq", value: requestId },
      ],
    },
    as,
  );
  return result.rows.map((row) => row.body);
}

describe("helpdesk request notes", () => {
  test("a SystemAdmin working from a customer tenant reads back the note on a request", async () => {
    const requestId = await submitAnonymous("emma@example.com");
    const roaming = await seedRoamingAdmin(ctx.stack, "operator@example.com");
    const operator: SessionUser = { ...roaming, roles: ["SystemAdmin", "TenantAdmin"] };

    await ctx.stack.http.writeOk(
      NotesHistoryHandlers.addNote,
      { entityType: HELPDESK_REQUEST_ENTITY, entityId: requestId, body: "Check the London probe." },
      operator,
    );

    expect(await notesOf(requestId, operator)).toEqual(["Check the London probe."]);
  });

  test("operators in two tenants each read only the notes of their own tenant", async () => {
    const requestId = await submitAnonymous("emma@example.com");
    const first = await seedRoamingAdmin(ctx.stack, "first@example.com");
    const second = await seedRoamingAdmin(ctx.stack, "second@example.com");
    const firstOperator: SessionUser = { ...first, roles: ["SystemAdmin", "TenantAdmin"] };
    const secondOperator: SessionUser = { ...second, roles: ["SystemAdmin", "TenantAdmin"] };
    for (const [operator, body] of [
      [firstOperator, "Written in the first tenant."],
      [secondOperator, "Written in the second tenant."],
    ] as const) {
      await ctx.stack.http.writeOk(
        NotesHistoryHandlers.addNote,
        { entityType: HELPDESK_REQUEST_ENTITY, entityId: requestId, body },
        operator,
      );
    }

    expect(await notesOf(requestId, firstOperator)).toEqual(["Written in the first tenant."]);
    expect(await notesOf(requestId, secondOperator)).toEqual(["Written in the second tenant."]);
  });

  test("a tenant member without a note of its own sees none on the request", async () => {
    const requestId = await submitAnonymous("emma@example.com");
    const roaming = await seedRoamingAdmin(ctx.stack, "operator@example.com");
    const operator: SessionUser = { ...roaming, roles: ["SystemAdmin", "TenantAdmin"] };
    await ctx.stack.http.writeOk(
      NotesHistoryHandlers.addNote,
      { entityType: HELPDESK_REQUEST_ENTITY, entityId: requestId, body: "Internal only." },
      operator,
    );
    const reporter = await seedReporter(ctx.stack, "rita@example.com");

    expect(await notesOf(requestId, reporter)).toEqual([]);
  });
});
