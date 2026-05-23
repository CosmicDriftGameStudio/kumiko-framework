import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { TableColumns } from "../../db/dialect";
import { createEventStoreExecutor, type EventStoreExecutor } from "../../db/event-store-executor";
import { buildEntityTable } from "../../db/table-builder";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
  type Registry,
} from "../../engine";
import { createEventsTable } from "../../event-store";
import { createTestDb, type TestDb, TestUsers, unsafeCreateEntityTable } from "../../stack";
import { createCascadeDeleteHook } from "../cascade-handler";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic tables
type Table = TableColumns<any>;

let testDb: TestDb;
let tdb: TenantDb;
let registry: Registry;
let departmentTable: Table;
let userTable: Table;
let sessionTable: Table;
let groupTable: Table;
let userGroupRestrictTable: Table;
let userGroupCascadeTable: Table;
let teamTable: Table;
let memberTable: Table;
let departmentExecutor: EventStoreExecutor;
let userExecutor: EventStoreExecutor;
let sessionExecutor: EventStoreExecutor;
let groupExecutor: EventStoreExecutor;
let userGroupRestrictExecutor: EventStoreExecutor;
let userGroupCascadeExecutor: EventStoreExecutor;
let teamExecutor: EventStoreExecutor;
let memberExecutor: EventStoreExecutor;

const admin = TestUsers.admin;

const departmentEntity = createEntity({
  table: "cascade_departments",
  fields: { name: createTextField() },
});
const userEntity = createEntity({
  table: "cascade_users",
  fields: { name: createTextField(), departmentId: createTextField() },
});
const sessionEntity = createEntity({
  table: "cascade_sessions",
  fields: { userId: createTextField(), token: createTextField() },
});
const groupEntity = createEntity({
  table: "cascade_groups",
  fields: { name: createTextField() },
});
// Two separate junction tables so one Registry can host both onDelete
// strategies (restrict + cascade) on the same user→group pair.
const userGroupRestrictEntity = createEntity({
  table: "cascade_user_group_restrict",
  fields: { userId: createTextField(), groupId: createTextField() },
});
const userGroupCascadeEntity = createEntity({
  table: "cascade_user_group_cascade",
  fields: { userId: createTextField(), groupId: createTextField() },
});
// setNull pair: team→member with onDelete "setNull" — members survive
// the team deletion with teamId nulled out.
const teamEntity = createEntity({
  table: "cascade_teams",
  fields: { name: createTextField() },
});
const memberEntity = createEntity({
  table: "cascade_members",
  fields: { name: createTextField(), teamId: createTextField() },
});

beforeAll(async () => {
  testDb = await createTestDb();
  await createEventsTable(testDb.db);
  tdb = createTenantDb(testDb.db, admin.tenantId);

  await unsafeCreateEntityTable(testDb.db, departmentEntity);
  await unsafeCreateEntityTable(testDb.db, userEntity);
  await unsafeCreateEntityTable(testDb.db, sessionEntity);
  await unsafeCreateEntityTable(testDb.db, groupEntity);
  await unsafeCreateEntityTable(testDb.db, userGroupRestrictEntity);
  await unsafeCreateEntityTable(testDb.db, userGroupCascadeEntity);
  await unsafeCreateEntityTable(testDb.db, teamEntity);
  await unsafeCreateEntityTable(testDb.db, memberEntity);

  departmentTable = buildEntityTable("department", departmentEntity);
  userTable = buildEntityTable("user", userEntity);
  sessionTable = buildEntityTable("session", sessionEntity);
  groupTable = buildEntityTable("group", groupEntity);
  userGroupRestrictTable = buildEntityTable("user-group-restrict", userGroupRestrictEntity);
  userGroupCascadeTable = buildEntityTable("user-group-cascade", userGroupCascadeEntity);
  teamTable = buildEntityTable("team", teamEntity);
  memberTable = buildEntityTable("member", memberEntity);

  const feature = defineFeature("cascade", (r) => {
    r.entity("department", departmentEntity);
    r.entity("user", userEntity);
    r.entity("session", sessionEntity);
    r.entity("group", groupEntity);
    r.entity("user-group-restrict", userGroupRestrictEntity);
    r.entity("user-group-cascade", userGroupCascadeEntity);
    r.entity("team", teamEntity);
    r.entity("member", memberEntity);

    r.relation("department", "users", {
      type: "hasMany",
      target: "user",
      foreignKey: "departmentId",
      onDelete: "restrict",
    });

    r.relation("user", "sessions", {
      type: "hasMany",
      target: "session",
      foreignKey: "userId",
      onDelete: "cascade",
    });

    r.relation("user", "groupsRestrict", {
      type: "manyToMany",
      target: "group",
      through: { table: "user-group-restrict", sourceKey: "userId", targetKey: "groupId" },
      onDelete: "restrict",
    });

    r.relation("user", "groupsCascade", {
      type: "manyToMany",
      target: "group",
      through: { table: "user-group-cascade", sourceKey: "userId", targetKey: "groupId" },
      onDelete: "cascade",
    });

    r.relation("team", "members", {
      type: "hasMany",
      target: "member",
      foreignKey: "teamId",
      onDelete: "setNull",
    });
  });

  registry = createRegistry([feature]);
  departmentExecutor = createEventStoreExecutor(departmentTable, departmentEntity, {
    entityName: "department",
  });
  userExecutor = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });
  sessionExecutor = createEventStoreExecutor(sessionTable, sessionEntity, {
    entityName: "session",
  });
  groupExecutor = createEventStoreExecutor(groupTable, groupEntity, { entityName: "group" });
  userGroupRestrictExecutor = createEventStoreExecutor(
    userGroupRestrictTable,
    userGroupRestrictEntity,
    { entityName: "user-group-restrict" },
  );
  userGroupCascadeExecutor = createEventStoreExecutor(
    userGroupCascadeTable,
    userGroupCascadeEntity,
    { entityName: "user-group-cascade" },
  );
  teamExecutor = createEventStoreExecutor(teamTable, teamEntity, { entityName: "team" });
  memberExecutor = createEventStoreExecutor(memberTable, memberEntity, { entityName: "member" });
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("cascade delete: restrict", () => {
  test("blocks delete when related records exist", async () => {
    const dept = await departmentExecutor.create({ name: "Engineering" }, admin, tdb);
    if (!dept.isSuccess) throw new Error("Setup failed");

    await userExecutor.create({ name: "Marc", departmentId: dept.data.id }, admin, tdb);

    const cascadeHook = createCascadeDeleteHook(registry, new Map([["user", userTable]]));

    await expect(
      cascadeHook.fn(
        {
          kind: "delete",
          id: dept.data.id,
          data: { tenantId: "00000000-0000-4000-8000-000000000001" },
          entityName: "department",
        },
        { db: tdb },
      ),
    ).rejects.toMatchObject({ code: "conflict", details: { reason: "delete_restricted" } });
  });

  test("allows delete when no related records", async () => {
    const dept = await departmentExecutor.create({ name: "Empty" }, admin, tdb);
    if (!dept.isSuccess) throw new Error("Setup failed");

    const cascadeHook = createCascadeDeleteHook(registry, new Map([["user", userTable]]));

    await expect(
      cascadeHook.fn(
        {
          kind: "delete",
          id: dept.data.id,
          data: { tenantId: "00000000-0000-4000-8000-000000000001" },
          entityName: "department",
        },
        { db: tdb },
      ),
    ).resolves.toBeUndefined();
  });
});

describe("cascade delete: cascade", () => {
  test("deletes related records when parent is deleted", async () => {
    const user = await userExecutor.create({ name: "Cascade User" }, admin, tdb);
    if (!user.isSuccess) throw new Error("Setup failed");

    await sessionExecutor.create({ userId: user.data.id, token: "abc" }, admin, tdb);
    await sessionExecutor.create({ userId: user.data.id, token: "def" }, admin, tdb);

    // Verify sessions exist
    const before = await sessionExecutor.list({}, admin, tdb);
    const sessionsBefore = before.rows.filter((r) => r["userId"] === user.data.id);
    expect(sessionsBefore.length).toBe(2);

    // Run cascade
    const cascadeHook = createCascadeDeleteHook(registry, new Map([["session", sessionTable]]));

    await cascadeHook.fn(
      {
        kind: "delete",
        id: user.data.id,
        data: { tenantId: "00000000-0000-4000-8000-000000000001" },
        entityName: "user",
      },
      { db: tdb },
    );

    // Sessions should be gone
    const after = await sessionExecutor.list({}, admin, tdb);
    const sessionsAfter = after.rows.filter((r) => r["userId"] === user.data.id);
    expect(sessionsAfter.length).toBe(0);
  });
});

describe("cascade delete: manyToMany restrict", () => {
  test("blocks delete when through-records exist", async () => {
    const user = await userExecutor.create({ name: "M2M Restrict User" }, admin, tdb);
    const group = await groupExecutor.create({ name: "Admins" }, admin, tdb);
    if (!user.isSuccess || !group.isSuccess) throw new Error("Setup failed");

    await userGroupRestrictExecutor.create(
      { userId: user.data.id, groupId: group.data.id },
      admin,
      tdb,
    );

    const cascadeHook = createCascadeDeleteHook(
      registry,
      new Map([["user-group-restrict", userGroupRestrictTable]]),
    );

    await expect(
      cascadeHook.fn(
        {
          kind: "delete",
          id: user.data.id,
          data: { tenantId: "00000000-0000-4000-8000-000000000001" },
          entityName: "user",
        },
        { db: tdb },
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      details: {
        reason: "delete_restricted",
        blockingEntity: "user-group-restrict",
      },
    });
  });

  test("allows delete when no through-records reference this entity", async () => {
    const user = await userExecutor.create({ name: "M2M Free User" }, admin, tdb);
    if (!user.isSuccess) throw new Error("Setup failed");

    const cascadeHook = createCascadeDeleteHook(
      registry,
      new Map([["user-group-restrict", userGroupRestrictTable]]),
    );

    await expect(
      cascadeHook.fn(
        {
          kind: "delete",
          id: user.data.id,
          data: { tenantId: "00000000-0000-4000-8000-000000000001" },
          entityName: "user",
        },
        { db: tdb },
      ),
    ).resolves.toBeUndefined();
  });
});

describe("cascade delete: manyToMany cascade", () => {
  test("deletes through-records but keeps target entities", async () => {
    const user = await userExecutor.create({ name: "M2M Cascade User" }, admin, tdb);
    const groupA = await groupExecutor.create({ name: "Group A" }, admin, tdb);
    const groupB = await groupExecutor.create({ name: "Group B" }, admin, tdb);
    if (!user.isSuccess || !groupA.isSuccess || !groupB.isSuccess) throw new Error("Setup failed");

    await userGroupCascadeExecutor.create(
      { userId: user.data.id, groupId: groupA.data.id },
      admin,
      tdb,
    );
    await userGroupCascadeExecutor.create(
      { userId: user.data.id, groupId: groupB.data.id },
      admin,
      tdb,
    );

    const before = await userGroupCascadeExecutor.list({}, admin, tdb);
    expect(before.rows.filter((r) => r["userId"] === user.data.id).length).toBe(2);

    const cascadeHook = createCascadeDeleteHook(
      registry,
      new Map([["user-group-cascade", userGroupCascadeTable]]),
    );

    await cascadeHook.fn(
      {
        kind: "delete",
        id: user.data.id,
        data: { tenantId: "00000000-0000-4000-8000-000000000001" },
        entityName: "user",
      },
      { db: tdb },
    );

    // Through-records for this user must be gone
    const after = await userGroupCascadeExecutor.list({}, admin, tdb);
    expect(after.rows.filter((r) => r["userId"] === user.data.id).length).toBe(0);

    // Target groups themselves must remain — cascade drops the M:N link,
    // not the referenced entities.
    const groups = await groupExecutor.list({}, admin, tdb);
    const groupIds = groups.rows.map((r) => r["id"]);
    expect(groupIds).toContain(groupA.data.id);
    expect(groupIds).toContain(groupB.data.id);
  });
});

describe("cascade delete: hasMany setNull", () => {
  test("nulls out FK on related records when parent is deleted", async () => {
    const team = await teamExecutor.create({ name: "SetNull Team" }, admin, tdb);
    if (!team.isSuccess) throw new Error("Setup failed");

    const m1 = await memberExecutor.create({ name: "Alice", teamId: team.data.id }, admin, tdb);
    const m2 = await memberExecutor.create({ name: "Bob", teamId: team.data.id }, admin, tdb);
    if (!m1.isSuccess || !m2.isSuccess) throw new Error("Setup failed");

    // Verify FK is set before cascade
    const before = await memberExecutor.list({}, admin, tdb);
    const teamMembers = before.rows.filter((r) => r["id"] === m1.data.id || r["id"] === m2.data.id);
    expect(teamMembers.every((r) => r["teamId"] === team.data.id)).toBe(true);

    const cascadeHook = createCascadeDeleteHook(registry, new Map([["member", memberTable]]));

    await cascadeHook.fn(
      {
        kind: "delete",
        id: team.data.id,
        data: { tenantId: "00000000-0000-4000-8000-000000000001" },
        entityName: "team",
      },
      { db: tdb },
    );

    // Members still exist, but teamId is now null
    const after = await memberExecutor.list({}, admin, tdb);
    const afterMembers = after.rows.filter((r) => r["id"] === m1.data.id || r["id"] === m2.data.id);
    expect(afterMembers.length).toBe(2);
    expect(afterMembers.every((r) => r["teamId"] === null)).toBe(true);
  });

  test("leaves unrelated records untouched", async () => {
    const teamA = await teamExecutor.create({ name: "Team A" }, admin, tdb);
    const teamB = await teamExecutor.create({ name: "Team B" }, admin, tdb);
    if (!teamA.isSuccess || !teamB.isSuccess) throw new Error("Setup failed");

    const mA = await memberExecutor.create({ name: "A-member", teamId: teamA.data.id }, admin, tdb);
    const mB = await memberExecutor.create({ name: "B-member", teamId: teamB.data.id }, admin, tdb);
    if (!mA.isSuccess || !mB.isSuccess) throw new Error("Setup failed");

    const cascadeHook = createCascadeDeleteHook(registry, new Map([["member", memberTable]]));

    // Delete team A — only mA should lose its teamId, mB must stay intact
    await cascadeHook.fn(
      {
        kind: "delete",
        id: teamA.data.id,
        data: { tenantId: "00000000-0000-4000-8000-000000000001" },
        entityName: "team",
      },
      { db: tdb },
    );

    const after = await memberExecutor.list({}, admin, tdb);
    const aAfter = after.rows.find((r) => r["id"] === mA.data.id);
    const bAfter = after.rows.find((r) => r["id"] === mB.data.id);
    expect(aAfter?.["teamId"]).toBeNull();
    expect(bAfter?.["teamId"]).toBe(teamB.data.id);
  });
});
