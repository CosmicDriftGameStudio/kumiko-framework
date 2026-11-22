// The user-data export of a letter lists the staff member's own part only, never the recipient.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createTenantDb } from "@cosmicdrift/kumiko-testing/helpers";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { letterDeleteHook, letterExportHook } from "../user-data-hooks.ts";
import { APPROVER, CLERK, createLetterHarness, SYSTEM_ADMIN, TENANT } from "./letter-harness.ts";

const harness = createLetterHarness();
const { letterInput, send } = harness;
let stack: TestStack;

beforeAll(async () => {
  stack = await harness.setup();
});

afterAll(async () => {
  await harness.cleanup();
});

beforeEach(async () => {
  await harness.reset();
});

function hookCtx(userId: typeof CLERK.id) {
  return {
    db: createTenantDb({ db: stack.db, tenantId: TENANT, mode: "tenant" }),
    registry: stack.registry,
    tenantId: TENANT,
    userId,
  };
}

const RECIPIENT_FIELDS = [
  "recipientName",
  "recipientStreet",
  "recipientHouseNumber",
  "recipientPostalCode",
  "recipientCity",
  "recognizedAddress",
  "failureDetail",
  "resolutionNote",
];

describe("letterExportHook", () => {
  test("lists the letters the user created, without any recipient field", async () => {
    const { letterId } = await send(await letterInput(), CLERK);
    const snippet = await letterExportHook(hookCtx(CLERK.id));
    expect(snippet?.entity).toBe("letter");
    expect(snippet?.rows.map((row) => row["id"])).toEqual([letterId]);
    expect(snippet?.rows[0]?.["createdBy"]).toBe(CLERK.id);
    for (const field of RECIPIENT_FIELDS) {
      expect(Object.keys(snippet?.rows[0] ?? {})).not.toContain(field);
    }
  });

  test("lists a letter once for a user who created and approved it", async () => {
    const { letterId } = await send(await letterInput(), APPROVER);
    await harness.approve(letterId);
    const snippet = await letterExportHook(hookCtx(APPROVER.id));
    expect(snippet?.rows.map((row) => row["id"])).toEqual([letterId]);
    expect(snippet?.rows[0]?.["approvedBy"]).toBe(APPROVER.id);
  });

  test("returns null for a user who touched no letter", async () => {
    await send(await letterInput(), CLERK);
    expect(await letterExportHook(hookCtx(SYSTEM_ADMIN.id))).toBeNull();
  });

  test("the delete hook leaves the letter untouched", async () => {
    const { letterId } = await send(await letterInput(), CLERK);
    expect(await letterDeleteHook(hookCtx(CLERK.id), "delete")).toBeUndefined();
    const snippet = await letterExportHook(hookCtx(CLERK.id));
    expect(snippet?.rows.map((row) => row["id"])).toEqual([letterId]);
  });
});
