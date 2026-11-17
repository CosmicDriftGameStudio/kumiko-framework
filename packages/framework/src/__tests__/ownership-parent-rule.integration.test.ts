// fromParent: child rows inherit read and write access from the parent row under the parent's
// own access map, over a site -> room -> fixture chain.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-testing/helpers";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { defineEntityQueryHandler, defineEntityWriteHandler } from "../engine/entity-handlers.ts";
import {
  createEntity,
  createReferenceField,
  createTextField,
  defineFeature,
  from,
  fromParent,
} from "../engine/index.ts";
import type { SessionUser } from "../engine/types/index.ts";
import { createTestUser, TestUsers, testTenantId } from "../seeding/seed-users.ts";

const siteEntity = createEntity({
  table: "parent_rule_sites",
  softDelete: true,
  fields: {
    teamId: createTextField({ personal: false, reason: "test_fixture", required: true }),
    name: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
  access: {
    read: { Admin: "all", Manager: from("claim:teams:teamId") },
    write: { Admin: "all", Manager: from("claim:teams:teamId") },
  },
});

const roomEntity = createEntity({
  table: "parent_rule_rooms",
  softDelete: true,
  fields: {
    siteId: createReferenceField({ entity: "site", personal: false, reason: "test_fixture" }),
    name: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
  access: {
    read: { Admin: "all", Manager: fromParent("siteId", "site") },
    write: { Admin: "all", Manager: fromParent("siteId", "site") },
  },
});

const fixtureEntity = createEntity({
  table: "parent_rule_fixtures",
  softDelete: true,
  fields: {
    roomId: createReferenceField({ entity: "room", personal: false, reason: "test_fixture" }),
    name: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
  access: {
    read: { Admin: "all", Manager: fromParent("roomId", "room") },
    write: { Admin: "all", Manager: fromParent("roomId", "room") },
  },
});

const roles = ["Admin", "Manager"] as const;

const facilitiesFeature = defineFeature("facilities", (r) => {
  const entities = [
    ["site", siteEntity],
    ["room", roomEntity],
    ["fixture", fixtureEntity],
  ] as const;
  for (const [name, entity] of entities) {
    r.entity({ name, ...entity });
    for (const verb of ["create", "update", "delete", "restore"] as const) {
      r.writeHandler(
        defineEntityWriteHandler(`${name}:${verb}`, entity, { access: { roles: [...roles] } }),
      );
    }
    for (const verb of ["list", "detail"] as const) {
      r.queryHandler(
        defineEntityQueryHandler(`${name}:${verb}`, entity, { access: { roles: [...roles] } }),
      );
    }
  }
});

const teamsFeature = defineFeature("teams", (r) => {
  r.claimKey({ name: "teamId", type: "string" });
});

const tenant = testTenantId(1);
const admin: SessionUser = { ...TestUsers.admin, tenantId: tenant };
const managerA = mkManager(1, "a");
const managerB = mkManager(2, "b");

function mkManager(n: number, team: string): SessionUser {
  return createTestUser({
    id: `33333333-0000-4000-8000-00000000000${n}`,
    tenantId: tenant,
    roles: ["Manager"],
    claims: { "teams:teamId": team },
  });
}

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [teamsFeature, facilitiesFeature] });
  await unsafeCreateEntityTable(stack.db, siteEntity, "site");
  await unsafeCreateEntityTable(stack.db, roomEntity, "room");
  await unsafeCreateEntityTable(stack.db, fixtureEntity, "fixture");
});

afterAll(async () => {
  await stack.cleanup();
});

type Written = { id: string; data: { version: number } };
type ListResult = { rows: Array<Record<string, unknown>> };

let siteA: string;
let siteB: string;
let roomA: Written;
let roomB: Written;
let fixtureA: string;
let fixtureB: string;

async function create(entity: string, payload: Record<string, unknown>, user: SessionUser) {
  return stack.http.writeOk<Written>(`facilities:write:${entity}:create`, payload, user);
}

beforeEach(async () => {
  await resetEventStore(stack, ["parent_rule_fixtures", "parent_rule_rooms", "parent_rule_sites"]);
  siteA = (await create("site", { teamId: "a", name: "Site A" }, admin)).id;
  siteB = (await create("site", { teamId: "b", name: "Site B" }, admin)).id;
  roomA = await create("room", { siteId: siteA, name: "Room A" }, admin);
  roomB = await create("room", { siteId: siteB, name: "Room B" }, admin);
  fixtureA = (await create("fixture", { roomId: roomA.id, name: "Fixture A" }, admin)).id;
  fixtureB = (await create("fixture", { roomId: roomB.id, name: "Fixture B" }, admin)).id;
});

function list(entity: string, user: SessionUser): Promise<ListResult> {
  return stack.http.queryOk<ListResult>(`facilities:query:${entity}:list`, {}, user);
}

function detail(entity: string, user: SessionUser, id: string) {
  return stack.http.queryOk<Record<string, unknown> | null>(
    `facilities:query:${entity}:detail`,
    { id },
    user,
  );
}

describe("fromParent read path", () => {
  test("room list shows only rooms under the manager's site", async () => {
    const rows = (await list("room", managerA)).rows;
    expect(rows.map((row) => row["id"])).toEqual([roomA.id]);
    expect((await list("room", managerB)).rows.map((row) => row["id"])).toEqual([roomB.id]);
  });

  test("room detail of a foreign room is not visible", async () => {
    expect(await detail("room", managerA, roomB.id)).toBeNull();
    expect(await detail("room", managerA, roomA.id)).not.toBeNull();
  });

  test("fixture list follows the chain fixture -> room -> site", async () => {
    expect((await list("fixture", managerA)).rows.map((row) => row["id"])).toEqual([fixtureA]);
    expect(await detail("fixture", managerA, fixtureB)).toBeNull();
  });
});

describe("fromParent write path", () => {
  test("create under the manager's own site succeeds, under a foreign site is denied", async () => {
    const ok = await create("room", { siteId: siteA, name: "New" }, managerA);
    expect(ok.id).toBeTruthy();
    const err = await stack.http.writeErr(
      "facilities:write:room:create",
      { siteId: siteB, name: "Rogue" },
      managerA,
    );
    expectErrorIncludes(err, "ownership_denied");
  });

  test("moving a room to a foreign site is denied, admin may do it", async () => {
    const err = await stack.http.writeErr(
      "facilities:write:room:update",
      { id: roomA.id, version: roomA.data.version, changes: { siteId: siteB } },
      managerA,
    );
    expectErrorIncludes(err, "ownership_denied");
    const moved = await stack.http.writeOk<Written>(
      "facilities:write:room:update",
      { id: roomA.id, version: roomA.data.version, changes: { siteId: siteB } },
      admin,
    );
    expect(moved.id).toBe(roomA.id);
  });

  test("delete and restore of a foreign room are denied", async () => {
    const deleteErr = await stack.http.writeErr(
      "facilities:write:room:delete",
      { id: roomB.id },
      managerA,
    );
    expectErrorIncludes(deleteErr, "not_found");
    await stack.http.writeOk("facilities:write:room:delete", { id: roomB.id }, admin);
    const restoreErr = await stack.http.writeErr(
      "facilities:write:room:restore",
      { id: roomB.id },
      managerA,
    );
    expectErrorIncludes(restoreErr, "not_found");
  });

  test("fixture create under a foreign room is denied, under an own room allowed", async () => {
    const ok = await create("fixture", { roomId: roomA.id, name: "New" }, managerA);
    expect(ok.id).toBeTruthy();
    const err = await stack.http.writeErr(
      "facilities:write:fixture:create",
      { roomId: roomB.id, name: "Rogue" },
      managerA,
    );
    expectErrorIncludes(err, "ownership_denied");
  });
});

describe("fromParent for admin", () => {
  test("sees and writes everything", async () => {
    expect((await list("room", admin)).rows).toHaveLength(2);
    expect((await list("fixture", admin)).rows).toHaveLength(2);
    const created = await create("fixture", { roomId: roomB.id, name: "Admin" }, admin);
    expect(created.id).toBeTruthy();
  });
});
