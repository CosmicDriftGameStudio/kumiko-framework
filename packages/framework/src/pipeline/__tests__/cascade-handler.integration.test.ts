// onDelete cascades run inside the delete lifecycle: every delete over HTTP applies the
// relations' strategies, recurses through grandchildren and runs the children's entity hooks.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { DeleteContext } from "@cosmicdrift/kumiko-types/hooks";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createEntity, createTextField, defineFeature } from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const admin = TestUsers.admin;

function textField() {
  return createTextField({ personal: false, reason: "test_fixture" });
}

const departmentEntity = createEntity({
  table: "cascade_departments",
  fields: { name: textField() },
});
const userEntity = createEntity({
  table: "cascade_users",
  fields: { name: textField(), departmentId: textField() },
});
const sessionEntity = createEntity({
  table: "cascade_sessions",
  fields: { userId: textField(), token: textField() },
});
const groupEntity = createEntity({ table: "cascade_groups", fields: { name: textField() } });
// Two separate junction tables so one Registry can host both onDelete
// strategies (restrict + cascade) on the same user→group pair.
const userGroupRestrictEntity = createEntity({
  table: "cascade_user_group_restrict",
  fields: { userId: textField(), groupId: textField() },
});
const userGroupCascadeEntity = createEntity({
  table: "cascade_user_group_cascade",
  fields: { userId: textField(), groupId: textField() },
});
// setNull pair: members survive the team deletion with teamId nulled out.
const teamEntity = createEntity({ table: "cascade_teams", fields: { name: textField() } });
const memberEntity = createEntity({
  table: "cascade_members",
  fields: { name: textField(), teamId: textField() },
});
const taskEntity = createEntity({
  table: "cascade_tasks",
  fields: { title: textField(), memberId: textField() },
});
// Grandchild chain: squad → recruit → badge, all cascade.
const squadEntity = createEntity({ table: "cascade_squads", fields: { name: textField() } });
const recruitEntity = createEntity({
  table: "cascade_recruits",
  fields: { name: textField(), squadId: textField() },
});
const badgeEntity = createEntity({
  table: "cascade_badges",
  fields: { label: textField(), recruitId: textField() },
});
// Restrict on the grandchild level: fort → bunker (cascade) → crate (restrict).
const fortEntity = createEntity({ table: "cascade_forts", fields: { name: textField() } });
const bunkerEntity = createEntity({
  table: "cascade_bunkers",
  fields: { name: textField(), fortId: textField() },
});
const crateEntity = createEntity({
  table: "cascade_crates",
  fields: { label: textField(), bunkerId: textField() },
});

const entities = {
  department: departmentEntity,
  user: userEntity,
  session: sessionEntity,
  group: groupEntity,
  "user-group-restrict": userGroupRestrictEntity,
  "user-group-cascade": userGroupCascadeEntity,
  team: teamEntity,
  member: memberEntity,
  task: taskEntity,
  squad: squadEntity,
  recruit: recruitEntity,
  badge: badgeEntity,
  fort: fortEntity,
  bunker: bunkerEntity,
  crate: crateEntity,
} as const;

const preDeletePayloads: DeleteContext[] = [];
const afterCommitDeleted: string[] = [];
const inTransactionDeleted: string[] = [];

const access = { access: { roles: ["Admin"] } } as const;

const cascadeFeature = defineFeature("cascade", (r) => {
  for (const [name, entity] of Object.entries(entities)) {
    r.entity({ ...entity, name });
  }

  r.relation({ entity: "department", name: "users", type: "hasMany",
    target: "user",
    foreignKey: "departmentId",
    onDelete: "restrict" });
  r.relation({ entity: "user", name: "sessions", type: "hasMany",
    target: "session",
    foreignKey: "userId",
    onDelete: "cascade" });
  r.relation({ entity: "user", name: "groupsRestrict", type: "manyToMany",
    target: "group",
    through: { table: "user-group-restrict", sourceKey: "userId", targetKey: "groupId" },
    onDelete: "restrict" });
  r.relation({ entity: "user", name: "groupsCascade", type: "manyToMany",
    target: "group",
    through: { table: "user-group-cascade", sourceKey: "userId", targetKey: "groupId" },
    onDelete: "cascade" });
  r.relation({ entity: "team", name: "members", type: "hasMany",
    target: "member",
    foreignKey: "teamId",
    onDelete: "setNull" });
  r.relation({ entity: "squad", name: "recruits", type: "hasMany",
    target: "recruit",
    foreignKey: "squadId",
    onDelete: "cascade" });
  r.relation({ entity: "recruit", name: "badges", type: "hasMany",
    target: "badge",
    foreignKey: "recruitId",
    onDelete: "cascade" });
  r.relation({ entity: "fort", name: "bunkers", type: "hasMany",
    target: "bunker",
    foreignKey: "fortId",
    onDelete: "cascade" });
  r.relation({ entity: "bunker", name: "crates", type: "hasMany",
    target: "crate",
    foreignKey: "bunkerId",
    onDelete: "restrict" });

  r.hook({
    type: "preDelete",
    target: { allOf: "recruit" },
    handler: async (payload) => {
      preDeletePayloads.push(payload);
    },
  });
  r.hook({
    type: "postDelete",
    target: { allOf: "recruit" },
    phase: "afterCommit",
    handler: async (payload) => {
      afterCommitDeleted.push(String(payload.id));
    },
  });
  r.hook({
    type: "postDelete",
    target: { allOf: "recruit" },
    phase: "inTransaction",
    handler: async (payload) => {
      inTransactionDeleted.push(String(payload.id));
    },
  });

  for (const [name, entity] of Object.entries(entities)) {
    r.crud({ ...entity, name: name }, { write: access, read: access, registerEntity: false });
  }
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [cascadeFeature] });
  for (const [name, entity] of Object.entries(entities)) {
    await unsafeCreateEntityTable(stack.db, entity, name);
  }
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  preDeletePayloads.length = 0;
  afterCommitDeleted.length = 0;
  inTransactionDeleted.length = 0;
  await resetEventStore(
    stack,
    Object.values(entities).map((entity) => entity.table as string),
  );
});

async function create(entity: keyof typeof entities, payload: Record<string, unknown>) {
  const created = await stack.http.writeOk<{ id: string }>(
    `cascade:write:${entity}:create`,
    payload,
    admin,
  );
  return created.id;
}

function remove(entity: keyof typeof entities, id: string) {
  return stack.http.writeOk(`cascade:write:${entity}:delete`, { id }, admin);
}

function removeErr(entity: keyof typeof entities, id: string) {
  return stack.http.writeErr(`cascade:write:${entity}:delete`, { id }, admin);
}

async function rowsOf(entity: keyof typeof entities): Promise<Record<string, unknown>[]> {
  const result = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
    `cascade:query:${entity}:list`,
    {},
    admin,
  );
  return result.rows;
}

describe("cascade delete: restrict", () => {
  test("blocks delete when related records exist", async () => {
    const dept = await create("department", { name: "Engineering" });
    await create("user", { name: "Marc", departmentId: dept });

    const err = await removeErr("department", dept);
    expect(err).toMatchObject({ code: "conflict", details: { reason: "delete_restricted" } });
    expect((await rowsOf("department")).map((row) => row["id"])).toContain(dept);
  });

  test("allows delete when no related records", async () => {
    const dept = await create("department", { name: "Empty" });
    await remove("department", dept);
    expect(await rowsOf("department")).toHaveLength(0);
  });
});

describe("cascade delete: cascade", () => {
  test("deletes related records when parent is deleted", async () => {
    const user = await create("user", { name: "Cascade User" });
    await create("session", { userId: user, token: "abc" });
    await create("session", { userId: user, token: "def" });
    expect(await rowsOf("session")).toHaveLength(2);

    await remove("user", user);

    expect(await rowsOf("session")).toHaveLength(0);
  });
});

describe("cascade delete: manyToMany restrict", () => {
  test("blocks delete when through-records exist", async () => {
    const user = await create("user", { name: "M2M Restrict User" });
    const group = await create("group", { name: "Admins" });
    await create("user-group-restrict", { userId: user, groupId: group });

    const err = await removeErr("user", user);
    expect(err).toMatchObject({
      code: "conflict",
      details: { reason: "delete_restricted", blockingEntity: "user-group-restrict" },
    });
  });

  test("allows delete when no through-records reference this entity", async () => {
    const user = await create("user", { name: "M2M Free User" });
    await remove("user", user);
    expect(await rowsOf("user")).toHaveLength(0);
  });
});

describe("cascade delete: manyToMany cascade", () => {
  test("deletes through-records but keeps target entities", async () => {
    const user = await create("user", { name: "M2M Cascade User" });
    const groupA = await create("group", { name: "Group A" });
    const groupB = await create("group", { name: "Group B" });
    await create("user-group-cascade", { userId: user, groupId: groupA });
    await create("user-group-cascade", { userId: user, groupId: groupB });
    expect(await rowsOf("user-group-cascade")).toHaveLength(2);

    await remove("user", user);

    expect(await rowsOf("user-group-cascade")).toHaveLength(0);
    // Cascade drops the M:N link, not the referenced entities.
    const groupIds = (await rowsOf("group")).map((row) => row["id"]);
    expect(groupIds).toContain(groupA);
    expect(groupIds).toContain(groupB);
  });
});

describe("cascade delete: hasMany setNull", () => {
  test("nulls out FK on related records when parent is deleted", async () => {
    const team = await create("team", { name: "SetNull Team" });
    const alice = await create("member", { name: "Alice", teamId: team });
    const bob = await create("member", { name: "Bob", teamId: team });

    await remove("team", team);

    const members = (await rowsOf("member")).filter((row) => [alice, bob].includes(String(row["id"])));
    expect(members).toHaveLength(2);
    expect(members.every((row) => row["teamId"] === null)).toBe(true);
  });

  test("leaves unrelated records untouched", async () => {
    const teamA = await create("team", { name: "Team A" });
    const teamB = await create("team", { name: "Team B" });
    const memberA = await create("member", { name: "A-member", teamId: teamA });
    const memberB = await create("member", { name: "B-member", teamId: teamB });

    await remove("team", teamA);

    const rows = await rowsOf("member");
    expect(rows.find((row) => row["id"] === memberA)?.["teamId"]).toBeNull();
    expect(rows.find((row) => row["id"] === memberB)?.["teamId"]).toBe(teamB);
  });
});

describe("cascade delete: recursion and child hooks", () => {
  test("deleting the root removes children and grandchildren", async () => {
    const squad = await create("squad", { name: "Alpha" });
    const recruit = await create("recruit", { name: "R1", squadId: squad });
    await create("badge", { label: "B1", recruitId: recruit });
    await create("badge", { label: "B2", recruitId: recruit });

    await remove("squad", squad);

    expect(await rowsOf("recruit")).toHaveLength(0);
    expect(await rowsOf("badge")).toHaveLength(0);
  });

  test("the child's entity preDelete hook sees cascadedFrom", async () => {
    const squad = await create("squad", { name: "Beta" });
    const recruit = await create("recruit", { name: "R1", squadId: squad });

    await remove("squad", squad);

    expect(preDeletePayloads).toHaveLength(1);
    expect(preDeletePayloads[0]?.id).toBe(recruit);
    expect(preDeletePayloads[0]?.cascadedFrom).toEqual({ entityName: "squad", id: squad });
  });

  test("an afterCommit postDelete hook of the child runs once per deleted child", async () => {
    const squad = await create("squad", { name: "Gamma" });
    const first = await create("recruit", { name: "R1", squadId: squad });
    const second = await create("recruit", { name: "R2", squadId: squad });

    await remove("squad", squad);

    expect([...afterCommitDeleted].sort()).toEqual([first, second].sort());
    expect([...inTransactionDeleted].sort()).toEqual([first, second].sort());
  });

  test("a delete of the child itself runs its hooks without cascadedFrom", async () => {
    const squad = await create("squad", { name: "Delta" });
    const recruit = await create("recruit", { name: "R1", squadId: squad });

    await remove("recruit", recruit);

    expect(preDeletePayloads).toHaveLength(1);
    expect(preDeletePayloads[0]?.cascadedFrom).toBeUndefined();
  });

  test("restrict on the grandchild level rolls the whole delete back", async () => {
    const fort = await create("fort", { name: "Keep" });
    const bunker = await create("bunker", { name: "B1", fortId: fort });
    await create("crate", { label: "C1", bunkerId: bunker });

    const err = await removeErr("fort", fort);
    expect(err).toMatchObject({ code: "conflict", details: { reason: "delete_restricted" } });

    expect((await rowsOf("fort")).map((row) => row["id"])).toContain(fort);
    expect((await rowsOf("bunker")).map((row) => row["id"])).toContain(bunker);
  });
});
