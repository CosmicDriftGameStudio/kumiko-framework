// Field Approval Sample — Integration Test
// Proves: a PropertyManager cannot change the IBAN directly, files a request,
// and a different Accountant applies it.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { SaveContext } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { contactFeature, fieldApprovalFeature } from "../feature";

let stack: TestStack;

const propertyManager = createTestUser({ id: 2, roles: ["PropertyManager"] });
const accountantA = createTestUser({ id: 3, roles: ["Accountant"] });
const accountantB = createTestUser({ id: 4, roles: ["Accountant"] });

const OLD_IBAN = "DE02120300000000202051";
const NEW_IBAN = "DE89370400440532013000";

beforeAll(async () => {
  stack = await setupTestStack({ features: [contactFeature, fieldApprovalFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

describe("field approval", () => {
  test("a second Accountant applies the IBAN change a PropertyManager requested", async () => {
    const created = await stack.http.writeOk<SaveContext>(
      "contacts:write:contact:create",
      { name: "Owner", iban: OLD_IBAN },
      accountantA,
    );
    const contactId = created.id;

    const refused = await stack.http.writeErr(
      "contacts:write:contact:update",
      { id: contactId, version: 1, changes: { iban: NEW_IBAN } },
      propertyManager,
    );
    expect(refused.httpStatus).toBe(403);
    expect(refused.details?.["reason"]).toBe("field_approval_required");

    await stack.http.writeOk(
      "field-approval:write:request-change",
      { entityType: "contact", entityId: contactId, fieldName: "iban", value: NEW_IBAN },
      propertyManager,
    );

    const pending = await stack.http.queryOk<{
      rows: Array<{ id: string; version: number; value: unknown; canApprove: boolean }>;
    }>("field-approval:query:pending-changes", {}, accountantB);
    expect(pending.rows).toHaveLength(1);
    expect(pending.rows[0]?.value).toBe(NEW_IBAN);
    expect(pending.rows[0]?.canApprove).toBe(true);

    await stack.http.writeOk(
      "field-approval:write:approve-change",
      { id: pending.rows[0]?.id, version: pending.rows[0]?.version },
      accountantB,
    );

    const detail = await stack.http.queryOk<Record<string, unknown>>(
      "contacts:query:contact:detail",
      { id: contactId },
      accountantA,
    );
    expect(detail["iban"]).toBe(NEW_IBAN);
  });
});
