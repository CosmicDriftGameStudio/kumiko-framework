// Relations Sample — Integration Test
// Proves: hasMany relations, cascade delete, restrict delete

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createCascadeDeleteHook } from "@cosmicdrift/kumiko-framework/pipeline";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  memberEntity,
  memberTable,
  relationsFeature,
  taskEntity,
  taskTable,
  teamEntity,
} from "../feature";

let stack: TestStack;

const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [relationsFeature] });
  await unsafeCreateEntityTable(stack.db, teamEntity);
  await unsafeCreateEntityTable(stack.db, memberEntity);
  await unsafeCreateEntityTable(stack.db, taskEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  stack.events.reset();
});

describe("restrict: team cannot be deleted with members", () => {
  test("delete team with members fails", async () => {
    const team = await stack.http.writeOk("org:write:team:create", { name: "Engineering" }, admin);
    await stack.http.writeOk(
      "org:write:member:create",
      {
        name: "Alice",
        teamId: team.id,
      },
      admin,
    );

    // Cascade hook would block this — test via hook directly
    const cascadeHook = createCascadeDeleteHook(stack.registry, new Map([["member", memberTable]]));

    await expect(
      cascadeHook.fn(
        {
          id: team.id,
          data: { tenantId: "00000000-0000-4000-8000-000000000001" },
          entityName: "team",
        },
        { db: stack.db },
      ),
    ).rejects.toMatchObject({ code: "conflict", details: { reason: "delete_restricted" } });
  });

  test("delete empty team succeeds", async () => {
    const team = await stack.http.writeOk("org:write:team:create", { name: "Empty Team" }, admin);

    const cascadeHook = createCascadeDeleteHook(stack.registry, new Map([["member", memberTable]]));

    await expect(
      cascadeHook.fn(
        {
          id: team.id,
          data: { tenantId: "00000000-0000-4000-8000-000000000001" },
          entityName: "team",
        },
        { db: stack.db },
      ),
    ).resolves.toBeUndefined();
  });
});

describe("cascade: deleting member removes tasks", () => {
  test("member's tasks are deleted when member is deleted", async () => {
    const team = await stack.http.writeOk("org:write:team:create", { name: "Cascade Team" }, admin);
    const member = await stack.http.writeOk(
      "org:write:member:create",
      {
        name: "Bob",
        teamId: team.id,
      },
      admin,
    );

    const task1 = await stack.http.writeOk(
      "org:write:task:create",
      {
        title: "Task A",
        memberId: member.id,
      },
      admin,
    );
    const task2 = await stack.http.writeOk(
      "org:write:task:create",
      {
        title: "Task B",
        memberId: member.id,
      },
      admin,
    );

    // Run cascade hook
    const cascadeHook = createCascadeDeleteHook(stack.registry, new Map([["task", taskTable]]));

    await cascadeHook.fn(
      {
        id: member.id,
        data: { tenantId: "00000000-0000-4000-8000-000000000001" },
        entityName: "member",
      },
      { db: stack.db },
    );

    // Tasks should be gone
    const detail1 = await stack.http.queryOk<null>(
      "org:query:task:detail",
      { id: task1.id },
      admin,
    );
    const detail2 = await stack.http.queryOk<null>(
      "org:query:task:detail",
      { id: task2.id },
      admin,
    );
    expect(detail1).toBeNull();
    expect(detail2).toBeNull();
  });
});
