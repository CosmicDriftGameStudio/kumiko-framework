// /api/sse carries change signals only: no field values for anyone, and
// anonymous connections only for entities an anonymous query declares.
// Every negative assertion waits for a sentinel frame that MUST arrive first,
// otherwise "PII is absent" would hold trivially on a silent stream.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createEventStoreExecutor } from "../db/event-store-executor.ts";
import { asRawClient } from "../db/query.ts";
import { buildEntityTable } from "../db/table-builder.ts";
import { createEntity, createTextField, defineFeature, type TenantId } from "../engine/index.ts";
import { TestUsers } from "../seeding/seed-users.ts";

const TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;

const ledgerEntity = createEntity({
  table: "sigframes_ledgers",
  fields: {
    email: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const ledgerTable = buildEntityTable("ledger", ledgerEntity);

const bannerEntity = createEntity({
  table: "sigframes_banners",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const bannerTable = buildEntityTable("banner", bannerEntity);

const signalFeature = defineFeature("sigframes", (r) => {
  r.entity({ name: "ledger", ...ledgerEntity });
  r.entity({ name: "banner", ...bannerEntity });

  r.writeHandler({
    name: "ledger:create",
    schema: z.object({ email: z.string() }),
    handler: async (event, ctx) => {
      const crud = createEventStoreExecutor(ledgerTable, ledgerEntity, { entityName: "ledger" });
      return crud.create({ email: event.payload.email }, event.user, ctx.db);
    },
    access: { roles: ["Admin"] },
  });
  r.writeHandler({
    name: "banner:create",
    schema: z.object({ title: z.string() }),
    handler: async (event, ctx) => {
      const crud = createEventStoreExecutor(bannerTable, bannerEntity, { entityName: "banner" });
      return crud.create({ title: event.payload.title }, event.user, ctx.db);
    },
    access: { roles: ["Admin"] },
  });

  r.queryHandler({
    name: "ledger:list",
    schema: z.object({}),
    handler: async () => [],
    access: { roles: ["Admin"] },
  });
  r.queryHandler({
    name: "banner:list",
    schema: z.object({}),
    handler: async () => [],
    access: { roles: ["Admin"] },
  });
  // No entity segment in the name — only liveEntities opens banner signals to anonymous.
  r.queryHandler({
    name: "current-banner",
    schema: z.object({}),
    handler: async () => ({}),
    access: { roles: ["anonymous", "User"] },
    liveEntities: ["banner"],
  });
});

type SseFrame = { readonly event: string; readonly data: string };

type SseConnection = {
  readonly rawBytes: () => string;
  readonly frames: () => readonly SseFrame[];
  readonly readUntilFrame: (eventName: string) => Promise<SseFrame>;
  readonly close: () => Promise<void>;
};

function parseFrames(raw: string): SseFrame[] {
  return raw
    .split("\n\n")
    .map((block) => ({
      event: block.match(/^event: (.*)$/m)?.[1],
      data: block.match(/^data: (.*)$/m)?.[1] ?? "",
    }))
    .filter((frame): frame is SseFrame => frame.event !== undefined && frame.event !== "ping");
}

let stack: TestStack;

async function openSse(headers: Record<string, string>): Promise<SseConnection> {
  const response = await stack.app.request("/api/sse", { headers });
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("SSE response has no body");
  const decoder = new TextDecoder();
  let received = "";
  const pump = async (): Promise<void> => {
    const { value, done } = await reader.read();
    if (done) throw new Error("SSE stream ended before the awaited frame arrived");
    received += decoder.decode(value, { stream: true });
  };
  while (!received.includes("event: ping")) await pump();
  return {
    rawBytes: () => received,
    frames: () => parseFrames(received),
    readUntilFrame: async (eventName) => {
      while (!parseFrames(received).some((frame) => frame.event === eventName)) await pump();
      const frame = parseFrames(received).find((candidate) => candidate.event === eventName);
      if (!frame) throw new Error(`frame ${eventName} vanished`);
      return frame;
    },
    close: () => reader.cancel(),
  };
}

async function openMemberSse(): Promise<SseConnection> {
  const token = await stack.jwt.sign(TestUsers.user);
  return openSse({ Authorization: `Bearer ${token}` });
}

async function createLedger(email: string): Promise<void> {
  await stack.http.writeOk("sigframes:write:ledger:create", { email }, TestUsers.admin);
}

async function createBanner(title: string): Promise<void> {
  await stack.http.writeOk("sigframes:write:banner:create", { title }, TestUsers.admin);
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [signalFeature],
    anonymousAccess: { defaultTenantId: TENANT_ID },
  });
  await unsafeCreateEntityTable(stack.db, ledgerEntity);
  await unsafeCreateEntityTable(stack.db, bannerEntity);
});

afterAll(() => stack.cleanup());

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${ledgerTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${bannerTable.tableName}"`);
});

describe("GET /api/sse signal-only frames", () => {
  test("a member without read access gets no signal for the private entity, only for the one they may read", async () => {
    const connection = await openMemberSse();
    const pii = `pii-${randomUUID()}@example.test`;

    await createLedger(pii);
    await createBanner("sentinel-banner");
    await stack.eventDispatcher?.runOnce();

    // The banner signal is sent after the ledger one, so once it arrives a ledger signal
    // would already be on the wire if the stream carried it.
    const sentinel = await connection.readUntilFrame("banner");
    await connection.close();

    expect(connection.frames().map((frame) => frame.event)).toEqual(["banner"]);
    const raw = connection.rawBytes();
    expect(raw).not.toContain(pii);
    expect(raw).not.toContain("sentinel-banner");
    expect(raw).not.toContain('"payload"');
    expect(raw).not.toContain('"changes"');
    expect(raw).not.toContain('"previous"');
    expect(JSON.parse(sentinel.data).aggregateType).toBe("banner");
  });

  test("an anonymous connection gets no frame for the private entity and only a bare signal without id or version for the declared one", async () => {
    const connection = await openSse({});
    const pii = `pii-${randomUUID()}@example.test`;

    await createLedger(pii);
    await createBanner("anon-sentinel-banner");
    await stack.eventDispatcher?.runOnce();

    const sentinel = await connection.readUntilFrame("banner");
    await connection.close();

    const raw = connection.rawBytes();
    expect(connection.frames().some((frame) => frame.event === "ledger")).toBe(false);
    expect(raw).not.toContain(pii);
    expect(raw).not.toContain("anon-sentinel-banner");
    expect(raw).not.toContain('"payload"');

    const signal = JSON.parse(sentinel.data);
    expect(signal.aggregateType).toBe("banner");
    expect(Object.keys(signal).sort()).toEqual(["aggregateType", "createdAt", "eventType"]);
  });
});
