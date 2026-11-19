// The generic HTTP entry (/api/write, /api/batch, /api/command, /api/query) is the trust boundary
// for client dispatches. It hides dispatchOnly handlers behind the 404 of an unknown handler and refuses an
// anonymous write under SYSTEM_TENANT_ID unless the handler declares tenantlessAnonymous.
// The gates sit in routes.ts, not the dispatcher, because ctx.dispatch must still reach both.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { defineFeature } from "../../engine/index.ts";
import { SYSTEM_TENANT_ID } from "../../engine/types/identifiers.ts";
import { createTestUser } from "../../seeding/seed-users.ts";

const RECORD_STEP = "entry-gates:write:record-step";
const RUN_FLOW = "entry-gates:write:run-flow";
const OPEN_INTAKE = "entry-gates:write:open-intake";
const SYSTEM_INTAKE = "entry-gates:write:system-intake";
const LOOKUP_SECRET = "entry-gates:query:lookup-secret";
const SHOW_LOOKUP = "entry-gates:query:show-lookup";

const NoteSchema = z.object({ note: z.string() });
const INTAKE_RATE_LIMIT = { per: "ip", limit: 50, windowSeconds: 60 } as const;

const gatesFeature = defineFeature("entry-gates", (r) => {
  r.writeHandler({
    name: "record-step",
    schema: NoteSchema,
    access: { roles: ["User"] },
    dispatchOnly: true,
    handler: async (event) => ({ isSuccess: true as const, data: { by: event.user.id } }),
  });
  r.writeHandler({
    name: "run-flow",
    schema: NoteSchema,
    access: { roles: ["User"] },
    handler: async (event, ctx) => ctx.dispatch.write(RECORD_STEP, { note: event.payload.note }),
  });
  r.writeHandler({
    name: "open-intake",
    schema: z.object({}),
    access: { roles: ["anonymous"] },
    rateLimit: INTAKE_RATE_LIMIT,
    handler: async () => ({ isSuccess: true as const, data: {} }),
  });
  r.writeHandler({
    name: "system-intake",
    schema: z.object({}),
    access: { roles: ["anonymous"] },
    rateLimit: INTAKE_RATE_LIMIT,
    tenantlessAnonymous: true,
    handler: async () => ({ isSuccess: true as const, data: {} }),
  });
  r.queryHandler({
    name: "lookup-secret",
    schema: z.object({}),
    access: { roles: ["User"] },
    dispatchOnly: true,
    handler: async (query) => ({ by: query.user.id }),
  });
  r.queryHandler({
    name: "show-lookup",
    schema: z.object({}),
    access: { roles: ["User"] },
    handler: async (_query, ctx) => ctx.dispatch.query(LOOKUP_SECRET, {}),
  });
});

const user = createTestUser({ id: 2, roles: ["User"] });
let stack: TestStack;
let ipCounter = 0;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [gatesFeature],
    anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

function nextClientIp(): string {
  ipCounter += 1;
  return `10.8.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

async function postAnonymous(path: string, body: unknown): Promise<Response> {
  return stack.app.request(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    nextClientIp(),
  );
}

describe("dispatchOnly handlers behind the HTTP entry", () => {
  test("/api/write answers a dispatchOnly handler like an unknown one", async () => {
    const hidden = await stack.http.writeErr(RECORD_STEP, { note: "x" }, user);
    const unknown = await stack.http.writeErr(
      "entry-gates:write:does-not-exist",
      { note: "x" },
      user,
    );
    expect(hidden.code).toBe("not_found");
    expect(hidden.httpStatus).toBe(404);
    expect(hidden.code).toBe(unknown.code);
  });

  test("/api/batch answers 404", async () => {
    const res = await stack.http.batch([{ type: RECORD_STEP, payload: { note: "x" } }], user);
    expect(res.status).toBe(404);
  });

  test("/api/command answers 404", async () => {
    const res = await stack.http.command(RECORD_STEP, { note: "x" }, user);
    expect(res.status).toBe(404);
  });

  test("ctx.dispatch still reaches it with the calling user", async () => {
    const data = await stack.http.writeOk<{ by: string }>(RUN_FLOW, { note: "x" }, user);
    expect(data.by).toBe(user.id);
  });

  test("/api/query answers a dispatchOnly query like an unknown one", async () => {
    const hidden = await stack.http.queryErr(LOOKUP_SECRET, {}, user);
    const unknown = await stack.http.queryErr("entry-gates:query:does-not-exist", {}, user);
    expect(hidden.code).toBe("not_found");
    expect(hidden.httpStatus).toBe(404);
    expect(hidden.code).toBe(unknown.code);
  });

  test("ctx.dispatch.query still reaches a dispatchOnly query with the calling user", async () => {
    const data = await stack.http.queryOk<{ by: string }>(SHOW_LOOKUP, {}, user);
    expect(data.by).toBe(user.id);
  });
});

describe("anonymous writes under SYSTEM_TENANT_ID", () => {
  test("a handler without tenantlessAnonymous fails with 422 tenant_required", async () => {
    const res = await postAnonymous("/api/write", { type: OPEN_INTAKE, payload: {} });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { details: { reason: string } } };
    expect(body.error.details.reason).toBe("tenant_required");
  });

  test("a tenantlessAnonymous handler runs", async () => {
    const res = await postAnonymous("/api/write", { type: SYSTEM_INTAKE, payload: {} });
    expect(res.status).toBe(200);
  });

  test("/api/batch applies the same gate", async () => {
    const res = await postAnonymous("/api/batch", {
      commands: [{ type: OPEN_INTAKE, payload: {} }],
    });
    expect(res.status).toBe(422);
  });

  test("a handler the anonymous role cannot call keeps its 401", async () => {
    const res = await postAnonymous("/api/write", { type: RUN_FLOW, payload: { note: "x" } });
    expect(res.status).toBe(401);
  });

  test("an unknown handler stays 404, not 422", async () => {
    const res = await postAnonymous("/api/write", {
      type: "entry-gates:write:missing",
      payload: {},
    });
    expect(res.status).toBe(404);
  });
});
