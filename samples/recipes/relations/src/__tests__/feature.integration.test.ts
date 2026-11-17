// Relations Sample — Integration Test
// Proves: hasMany relations, cascade delete, restrict delete

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SaveContext } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { relationsFeature } from "../feature";

let stack: TestStack;

const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [relationsFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  stack.events.reset();
});

describe("restrict: team cannot be deleted with members", () => {
  test("delete team with members fails", async () => {
    const team = await stack.http.writeOk<SaveContext>(
      "org:write:team:create",
      { name: "Engineering" },
      admin,
    );
    await stack.http.writeOk<SaveContext>(
      "org:write:member:create",
      {
        name: "Alice",
        teamId: team.id,
      },
      admin,
    );

    const err = await stack.http.writeErr("org:write:team:delete", { id: team.id }, admin);
    expect(err).toMatchObject({ code: "conflict", details: { reason: "delete_restricted" } });
  });

  test("delete empty team succeeds", async () => {
    const team = await stack.http.writeOk<SaveContext>(
      "org:write:team:create",
      { name: "Empty Team" },
      admin,
    );

    await stack.http.writeOk("org:write:team:delete", { id: team.id }, admin);
  });
});

describe("cascade: deleting member removes tasks", () => {
  test("member's tasks are deleted when member is deleted", async () => {
    const team = await stack.http.writeOk<SaveContext>(
      "org:write:team:create",
      { name: "Cascade Team" },
      admin,
    );
    const member = await stack.http.writeOk<SaveContext>(
      "org:write:member:create",
      {
        name: "Bob",
        teamId: team.id,
      },
      admin,
    );

    const task1 = await stack.http.writeOk<SaveContext>(
      "org:write:task:create",
      {
        title: "Task A",
        memberId: member.id,
      },
      admin,
    );
    const task2 = await stack.http.writeOk<SaveContext>(
      "org:write:task:create",
      {
        title: "Task B",
        memberId: member.id,
      },
      admin,
    );

    await stack.http.writeOk("org:write:member:delete", { id: member.id }, admin);

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
