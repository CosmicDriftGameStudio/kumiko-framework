// Field Access Sample — Integration Test
// Proves: field-level read/write restrictions per role

import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-framework/testing";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { employeeEntity, employeeFeature } from "../feature";

let stack: TestStack;

const adminUser = TestUsers.admin;
const accountingUser = createTestUser({ id: 2, roles: ["Accounting"] });
const employeeUser = createTestUser({ id: 3, roles: ["Employee"] });

beforeAll(async () => {
  stack = await setupTestStack({ features: [employeeFeature] });
  await unsafeCreateEntityTable(stack.db, employeeEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

async function seedEmployee(): Promise<string> {
  const data = await stack.http.writeOk(
    "hr:write:employee:create",
    {
      name: "Test Employee",
      email: "test@company.de",
      salary: 75000,
      internalNotes: "Top performer",
    },
    adminUser,
  );
  return data.id as number;
}

describe("read access: field filtering per role", () => {
  test("Admin sees all fields", async () => {
    const id = await seedEmployee();
    const detail = await stack.http.queryOk<Record<string, unknown>>(
      "hr:query:employee:detail",
      { id },
      adminUser,
    );

    expect(detail["name"]).toBe("Test Employee");
    expect(detail["salary"]).toBe(75000);
    expect(detail["internalNotes"]).toBe("Top performer");
  });

  test("Accounting sees salary but not internalNotes", async () => {
    const id = await seedEmployee();
    const detail = await stack.http.queryOk<Record<string, unknown>>(
      "hr:query:employee:detail",
      { id },
      accountingUser,
    );

    expect(detail["name"]).toBe("Test Employee");
    expect(detail["salary"]).toBe(75000);
    expect(detail["internalNotes"]).toBeUndefined();
  });

  test("Employee sees neither salary nor internalNotes", async () => {
    const id = await seedEmployee();
    const detail = await stack.http.queryOk<Record<string, unknown>>(
      "hr:query:employee:detail",
      { id },
      employeeUser,
    );

    expect(detail["name"]).toBe("Test Employee");
    expect(detail["salary"]).toBeUndefined();
    expect(detail["internalNotes"]).toBeUndefined();
  });
});

describe("write access: field-level write restrictions", () => {
  test("Admin can write salary", async () => {
    const id = await seedEmployee();
    const updated = await stack.http.writeOk(
      "hr:write:employee:update",
      {
        id,
        changes: { salary: 80000 },
        version: 1,
      },
      adminUser,
    );

    expect(updated.data["salary"]).toBe(80000);
  });

  test("Accounting cannot write salary (read-only)", async () => {
    const id = await seedEmployee();
    const error = await stack.http.writeErr(
      "hr:write:employee:update",
      {
        id,
        changes: { salary: 99999 },
        version: 1,
      },
      accountingUser,
    );

    expectErrorIncludes(error, "field_access_denied");
  });

  test("Employee cannot write salary", async () => {
    const id = await seedEmployee();
    const error = await stack.http.writeErr(
      "hr:write:employee:update",
      {
        id,
        changes: { salary: 1000000 },
        version: 1,
      },
      employeeUser,
    );

    expectErrorIncludes(error, "field_access_denied");
  });

  test("Employee can write unrestricted fields", async () => {
    const id = await seedEmployee();
    const updated = await stack.http.writeOk(
      "hr:write:employee:update",
      {
        id,
        changes: { name: "Updated Name" },
        version: 1,
      },
      employeeUser,
    );

    expect(updated.data["name"]).toBe("Updated Name");
  });
});
