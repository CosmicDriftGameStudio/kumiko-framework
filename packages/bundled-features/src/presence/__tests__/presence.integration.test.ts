// Presence over the real stack: HTTP heartbeats, the Redis store of the test stack, the real
// user feature for display names and the SSE broker for the addressed live frames.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  type EntityDefinition,
  tenantChannel,
} from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  resetPiiSubjectKmsForTests,
  seedRowViaEventStore,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  PRESENCE_CHANGED_EVENT,
  PRESENCE_QUERIES,
  PRESENCE_WRITES,
  type PresenceHeartbeatResult,
  type PresenceListResult,
} from "@cosmicdrift/kumiko-types/presence-types";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity } from "../../user/schema/user.ts";
import { seedUser } from "../../user/seeding.ts";
import { createPresenceFeature } from "../feature.ts";

const tenantId = testTenantId(1);
const otherTenantId = testTenantId(2);

const docEntity = createEntity({
  table: "presence_test_docs",
  fields: {
    title: createTextField({
      required: true,
      maxLength: 64,
      personal: false,
      reason: "technical_reference",
    }),
  },
});
const docTable = buildEntityTable("doc", docEntity);

const teamOwnership: NonNullable<EntityDefinition["access"]> = {
  read: {
    TenantMember: {
      kind: "where",
      where: (user, ctx) => ({
        sqlText: `${ctx.tableName}.title = $${ctx.paramStart}`,
        params: [user.claims?.["team"] ?? null],
      }),
    },
  },
};
const guardedEntity = createEntity({
  table: "presence_test_guarded",
  fields: {
    title: createTextField({
      required: true,
      maxLength: 64,
      personal: false,
      reason: "technical_reference",
    }),
  },
  access: teamOwnership,
});
const guardedTable = buildEntityTable("guarded", guardedEntity);

const fixtures = defineFeature("presence-test-fixtures", (r) => {
  r.entity({ name: "doc", ...docEntity });
  r.entity({ name: "guarded", ...guardedEntity });
});

const DOC = "50000000-0000-4000-8000-000000000001";
const DOC_FOREIGN = "50000000-0000-4000-8000-000000000002";
const GUARDED = "50000000-0000-4000-8000-000000000003";
const TTL_SECONDS = 45;

type Frame = { readonly type: string; readonly data: Record<string, unknown> };

let stack: TestStack;
let nowMs = Date.parse("2026-11-01T10:00:00.000Z");
const clock = { now: () => Temporal.Instant.fromEpochMilliseconds(nowMs) };

let ada: ReturnType<typeof createTestUser>;
let bob: ReturnType<typeof createTestUser>;
let carol: ReturnType<typeof createTestUser>;
let outsider: ReturnType<typeof createTestUser>;
let frames: Frame[] = [];

beforeAll(async () => {
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createPresenceFeature({ entities: ["doc", "guarded"], ttlSeconds: TTL_SECONDS }),
      fixtures,
    ],
    extraContext: { clock },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, docEntity);
  await unsafeCreateEntityTable(stack.db, guardedEntity);

  const seeded = await Promise.all(
    ["Ada Lovelace", "Bob Builder", "Carol Danvers", "Olga Outsider"].map((displayName, index) =>
      seedUser(stack.db, {
        email: `presence-${index}@example.com`,
        displayName,
        emailVerified: true,
      }),
    ),
  );
  const [adaRow, bobRow, carolRow, outsiderRow] = seeded;
  ada = createTestUser({ id: adaRow?.id, roles: ["TenantMember"], claims: { team: "team-a" } });
  bob = createTestUser({ id: bobRow?.id, roles: ["TenantMember"], claims: { team: "team-a" } });
  carol = createTestUser({ id: carolRow?.id, roles: ["TenantMember"], claims: { team: "team-b" } });
  outsider = createTestUser({
    id: outsiderRow?.id,
    roles: ["TenantMember"],
    tenantId: otherTenantId,
  });

  await seedRowViaEventStore(stack.db, docTable, { id: DOC, tenantId, title: "Doc" });
  await seedRowViaEventStore(stack.db, docTable, {
    id: DOC_FOREIGN,
    tenantId: otherTenantId,
    title: "Foreign",
  });
  await seedRowViaEventStore(stack.db, guardedTable, { id: GUARDED, tenantId, title: "team-a" });

  stack.sseBroker.addClient(
    tenantChannel(tenantId),
    (event) => frames.push({ type: event.type, data: event.data }),
    () => {},
  );
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(async () => {
  frames = [];
  nowMs += 10 * TTL_SECONDS * 1000;
});

function heartbeat(
  user: typeof ada,
  fields: { entity?: string; id?: string; activity?: string; focus?: string } = {},
) {
  return stack.http.writeOk<PresenceHeartbeatResult>(
    PRESENCE_WRITES.heartbeat,
    { entity: "doc", id: DOC, activity: "viewing", ...fields },
    user,
  );
}

function list(user: typeof ada, ids: readonly string[] = [DOC], entity = "doc") {
  return stack.http.queryOk<PresenceListResult>(PRESENCE_QUERIES.list, { entity, ids }, user);
}

function presenceFrames(): Frame[] {
  return frames.filter((frame) => frame.type === PRESENCE_CHANGED_EVENT);
}

describe("presence", () => {
  test("a second user in the same tenant sees the first with name, activity and since", async () => {
    await heartbeat(ada, { activity: "editing", focus: "field:title" });
    const seen = await heartbeat(bob);

    expect(seen.others).toHaveLength(1);
    expect(seen.others[0]).toMatchObject({
      userId: ada.id,
      displayName: "Ada Lovelace",
      activity: "editing",
      focus: "field:title",
      since: Temporal.Instant.fromEpochMilliseconds(nowMs).toString(),
    });
    const byId = (await list(bob)).byId;
    expect(byId[DOC]?.map((entry) => entry.displayName)).toEqual(["Ada Lovelace"]);
  });

  test("the caller never sees their own entry", async () => {
    const seen = await heartbeat(ada);
    expect(seen.others).toEqual([]);
    expect((await list(ada)).byId).toEqual({});
  });

  test("since stays while activity and focus are unchanged and moves when they change", async () => {
    await heartbeat(ada);
    const first = Temporal.Instant.fromEpochMilliseconds(nowMs).toString();
    nowMs += 10_000;
    await heartbeat(ada);
    expect((await heartbeat(bob)).others[0]?.since).toBe(first);

    nowMs += 5_000;
    await heartbeat(ada, { activity: "editing" });
    expect((await heartbeat(bob)).others[0]?.since).toBe(
      Temporal.Instant.fromEpochMilliseconds(nowMs).toString(),
    );
  });

  test("a user of another tenant sees nothing and the room of the first tenant stays closed", async () => {
    await heartbeat(ada);
    expect((await list(outsider)).byId).toEqual({});
    const denied = await stack.http.writeErr(
      PRESENCE_WRITES.heartbeat,
      { entity: "doc", id: DOC, activity: "viewing" },
      outsider,
    );
    expect(denied.httpStatus).toBe(404);
  });

  test("a row that is not visible to the caller answers 404 and stays out of the list", async () => {
    await heartbeat(ada, { entity: "guarded", id: GUARDED });
    const denied = await stack.http.writeErr(
      PRESENCE_WRITES.heartbeat,
      { entity: "guarded", id: GUARDED, activity: "viewing" },
      carol,
    );
    expect(denied.httpStatus).toBe(404);
    expect((await list(carol, [GUARDED], "guarded")).byId).toEqual({});
    const visible = await list(bob, [GUARDED], "guarded");
    expect(visible.byId[GUARDED]?.map((entry) => entry.userId)).toEqual([ada.id]);
  });

  test("a row of another tenant answers 404", async () => {
    const denied = await stack.http.writeErr(
      PRESENCE_WRITES.heartbeat,
      { entity: "doc", id: DOC_FOREIGN, activity: "viewing" },
      ada,
    );
    expect(denied.httpStatus).toBe(404);
  });

  test("an entity outside the allowlist is rejected", async () => {
    const denied = await stack.http.writeErr(
      PRESENCE_WRITES.heartbeat,
      { entity: "user", id: ada.id, activity: "viewing" },
      ada,
    );
    expect(denied.httpStatus).toBe(404);
    expect((await list(ada, [ada.id], "user")).byId).toEqual({});
  });

  test("an invalid focus is rejected as a validation error", async () => {
    const invalid = await stack.http.writeErr(
      PRESENCE_WRITES.heartbeat,
      { entity: "doc", id: DOC, activity: "viewing", focus: "has space" },
      ada,
    );
    expect(invalid.httpStatus).toBe(400);
  });

  test("after leave the entry is gone", async () => {
    await heartbeat(ada);
    await stack.http.writeOk(PRESENCE_WRITES.leave, { entity: "doc", id: DOC }, ada);
    expect((await heartbeat(bob)).others).toEqual([]);
  });

  test("an entry expires after the ttl without a heartbeat", async () => {
    await heartbeat(ada);
    nowMs += (TTL_SECONDS - 1) * 1000;
    expect((await list(bob)).byId[DOC]).toHaveLength(1);
    nowMs += 2 * 1000;
    expect((await list(bob)).byId).toEqual({});
  });

  test("a change reaches each present user as an addressed frame, a plain keep-alive does not", async () => {
    await heartbeat(bob);
    frames = [];

    await heartbeat(ada);
    expect(presenceFrames()).toHaveLength(1);
    expect(presenceFrames()[0]?.data).toEqual({ userId: bob.id, entity: "doc", id: DOC });

    frames = [];
    await heartbeat(ada);
    expect(presenceFrames()).toHaveLength(0);

    await heartbeat(ada, { activity: "editing" });
    expect(presenceFrames()).toHaveLength(1);

    frames = [];
    await stack.http.writeOk(PRESENCE_WRITES.leave, { entity: "doc", id: DOC }, ada);
    expect(presenceFrames().map((frame) => frame.data["userId"])).toEqual([bob.id]);
  });

  test("a frame is sent only when someone else is present", async () => {
    await heartbeat(ada);
    expect(presenceFrames()).toHaveLength(0);
  });

  test("an anonymous call is rejected", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: PRESENCE_WRITES.heartbeat,
      payload: { entity: "doc", id: DOC, activity: "viewing" },
    });
    expect(res.status).toBe(401);
  });

  test("a role outside the feature roles is denied", async () => {
    const driver = createTestUser({ id: ada.id, roles: ["Driver"] });
    const denied = await stack.http.writeErr(
      PRESENCE_WRITES.heartbeat,
      { entity: "doc", id: DOC, activity: "viewing" },
      driver,
    );
    expect(denied.httpStatus).toBe(403);
  });
});
