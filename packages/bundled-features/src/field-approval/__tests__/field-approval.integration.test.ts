// field-approval over the real stack: executor gate (access.approve), request/approve/reject
// handlers, version pin and the host-subject encryption of the pending value.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
} from "@cosmicdrift/kumiko-framework/crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { fieldChangeRequestAggregateId } from "../aggregate-id.ts";
import { FieldApprovalHandlers, FieldApprovalQueries } from "../constants.ts";
import { fieldChangeRequestTable } from "../executor.ts";
import { createFieldApprovalFeature } from "../feature.ts";

const roles = ["PropertyManager", "Accountant"] as const;
const readRoles = [...roles, "Viewer"] as const;
const crudAccess = { access: { roles } } as const;

const contactEntity = createEntity({
  name: "contact",
  table: "read_fa_test_contacts",
  fields: {
    name: createTextField({
      required: true,
      maxLength: 64,
      personal: false,
      reason: "technical_reference",
    }),
    iban: createTextField({
      maxLength: 34,
      personal: "self",
      find: "secret",
      access: { approve: ["Accountant"], write: ["PropertyManager", "Accountant"] },
    }),
    bic: createTextField({
      maxLength: 11,
      personal: false,
      reason: "technical_reference",
      access: {
        approve: ["Accountant"],
        write: ["PropertyManager", "Accountant"],
        read: ["PropertyManager"],
      },
    }),
  },
});

const contactFixtureFeature = defineFeature("fa-fixture", (r) => {
  r.crud(contactEntity, {
    write: crudAccess,
    read: { access: { roles: readRoles } },
    verbs: { delete: false, list: false, restore: false },
  });
});

const CREATE = "fa-fixture:write:contact:create";
const UPDATE = "fa-fixture:write:contact:update";
const DETAIL = "fa-fixture:query:contact:detail";

const pm = createTestUser({ id: 2, roles: ["PropertyManager"] });
const pm2 = createTestUser({ id: 5, roles: ["PropertyManager"] });
const accA = createTestUser({ id: 3, roles: ["Accountant"] });
const accB = createTestUser({ id: 4, roles: ["Accountant"] });
const viewer = createTestUser({ id: 6, roles: ["Viewer"] });

const OLD_IBAN = "DE02120300000000202051";
const NEW_IBAN = "DE89370400440532013000";
const SECOND_IBAN = "DE75512108001245126199";

type PendingRows = {
  rows: Array<{
    id: string;
    version: number;
    fieldName: string;
    value: unknown;
    canApprove: boolean;
  }>;
};

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      contactFixtureFeature,
      createFieldApprovalFeature({ parents: ["contact"], roles: readRoles }),
    ],
  });
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

async function seedContact(): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    CREATE,
    { name: "Owner", iban: OLD_IBAN },
    accA,
  );
  return created.id;
}

async function currentIban(contactId: string): Promise<unknown> {
  const detail = await stack.http.queryOk<Record<string, unknown>>(
    DETAIL,
    { id: contactId },
    accA,
  );
  return detail["iban"];
}

async function fileRequest(
  contactId: string,
  value: string,
  user: typeof pm,
): Promise<{ id: string }> {
  return stack.http.writeOk<{ id: string }>(
    FieldApprovalHandlers.requestChange,
    { entityType: "contact", entityId: contactId, fieldName: "iban", value },
    user,
  );
}

async function pendingFor(user: typeof pm, contactId: string): Promise<PendingRows["rows"]> {
  const result = await stack.http.queryOk<PendingRows>(
    FieldApprovalQueries.pendingChanges,
    { entityType: "contact", entityId: contactId },
    user,
  );
  return result.rows;
}

describe("field-approval executor gate", () => {
  test("a non-approver cannot change the field directly", async () => {
    const contactId = await seedContact();
    const error = await stack.http.writeErr(
      UPDATE,
      { id: contactId, version: 1, changes: { iban: NEW_IBAN } },
      pm,
    );
    expect(error.httpStatus).toBe(403);
    expect(error.details).toMatchObject({ reason: "field_approval_required", fields: ["iban"] });
    expect(await currentIban(contactId)).toBe(OLD_IBAN);
  });

  test("an unchanged gated value passes, proving the comparison runs on the decrypted snapshot", async () => {
    const contactId = await seedContact();
    await stack.http.writeOk(
      UPDATE,
      { id: contactId, version: 1, changes: { name: "x", iban: OLD_IBAN } },
      pm,
    );
  });

  test("create by a non-approver is refused with the field and passes without it", async () => {
    const refused = await stack.http.writeErr(CREATE, { name: "A", iban: OLD_IBAN }, pm);
    expect(refused.httpStatus).toBe(403);
    expect(refused.details).toMatchObject({ reason: "field_approval_required" });
    await stack.http.writeOk(CREATE, { name: "B" }, pm);
  });

  test("an approver writes the field directly", async () => {
    const contactId = await seedContact();
    await stack.http.writeOk(
      UPDATE,
      { id: contactId, version: 1, changes: { iban: NEW_IBAN } },
      accA,
    );
    expect(await currentIban(contactId)).toBe(NEW_IBAN);
  });
});

describe("field-approval request flow", () => {
  test("a role that may not write the field cannot file a change", async () => {
    const contactId = await seedContact();
    const error = await stack.http.writeErr(
      FieldApprovalHandlers.requestChange,
      { entityType: "contact", entityId: contactId, fieldName: "iban", value: NEW_IBAN },
      viewer,
    );
    expect(error.httpStatus).toBe(403);
  });

  test("an approver who may not read the field does not see its pending change", async () => {
    const contactId = await seedContact();
    await stack.http.writeOk(
      FieldApprovalHandlers.requestChange,
      { entityType: "contact", entityId: contactId, fieldName: "bic", value: "COBADEFFXXX" },
      pm,
    );

    expect((await pendingFor(accA, contactId)).map((row) => row.fieldName)).not.toContain("bic");
    expect((await pendingFor(pm, contactId)).map((row) => row.fieldName)).toContain("bic");
  });

  test("a request is stored encrypted and visible only to approvers and its requester", async () => {
    const contactId = await seedContact();
    const { id } = await fileRequest(contactId, NEW_IBAN, pm);

    const raw = await selectMany<{ requestedValue: unknown }>(stack.db, fieldChangeRequestTable, {
      id,
    });
    expect(isPiiCiphertext(raw[0]?.requestedValue)).toBe(true);

    const forApprover = await pendingFor(accA, contactId);
    expect(forApprover).toHaveLength(1);
    expect(forApprover[0]?.value).toBe(NEW_IBAN);
    expect(forApprover[0]?.canApprove).toBe(true);
    expect(await pendingFor(pm2, contactId)).toHaveLength(0);
  });

  test("a non-approver cannot approve", async () => {
    const contactId = await seedContact();
    const { id } = await fileRequest(contactId, NEW_IBAN, pm);
    const error = await stack.http.writeErr(
      FieldApprovalHandlers.approveChange,
      { id, version: 1 },
      pm,
    );
    expect(error.httpStatus).toBe(403);
  });

  test("approve pins the request version a re-filed request has moved past", async () => {
    const contactId = await seedContact();
    const first = await fileRequest(contactId, NEW_IBAN, pm);
    const seen = (await pendingFor(accB, contactId)).find((row) => row.id === first.id);
    if (seen === undefined) throw new Error("expected a pending request");

    await fileRequest(contactId, SECOND_IBAN, pm);
    const stale = await stack.http.writeErr(
      FieldApprovalHandlers.approveChange,
      { id: seen.id, version: seen.version },
      accB,
    );
    expect(stale.httpStatus).toBe(409);

    const fresh = (await pendingFor(accB, contactId)).find((row) => row.id === first.id);
    if (fresh === undefined) throw new Error("expected a pending request");
    await stack.http.writeOk(
      FieldApprovalHandlers.approveChange,
      { id: fresh.id, version: fresh.version },
      accB,
    );
    expect(await currentIban(contactId)).toBe(SECOND_IBAN);
  });

  test("the requester cannot approve their own request", async () => {
    const contactId = await seedContact();
    const { id } = await fileRequest(contactId, NEW_IBAN, accA);
    const seen = (await pendingFor(accA, contactId)).find((row) => row.id === id);
    const error = await stack.http.writeErr(
      FieldApprovalHandlers.approveChange,
      { id, version: seen?.version ?? 1 },
      accA,
    );
    expect(error.httpStatus).toBe(403);
    expect(error.details).toMatchObject({ reason: "field_change_self_approval" });
  });

  test("a decided request drops its value and cannot be decided twice", async () => {
    const contactId = await seedContact();
    const { id } = await fileRequest(contactId, NEW_IBAN, pm);
    const seen = (await pendingFor(accB, contactId)).find((row) => row.id === id);
    await stack.http.writeOk(
      FieldApprovalHandlers.approveChange,
      { id, version: seen?.version },
      accB,
    );

    const raw = await selectMany<{ status: string; requestedValue: unknown }>(
      stack.db,
      fieldChangeRequestTable,
      { id },
    );
    expect(raw[0]?.status).toBe("approved");
    expect(raw[0]?.requestedValue).toBeNull();

    const again = await stack.http.writeErr(
      FieldApprovalHandlers.approveChange,
      { id, version: (seen?.version ?? 1) + 1 },
      accB,
    );
    expect(again.httpStatus).toBe(422);
    expect(again.details).toMatchObject({ reason: "field_change_request_not_pending" });
  });

  test("the requester withdraws their request and the host stays unchanged", async () => {
    const contactId = await seedContact();
    const { id } = await fileRequest(contactId, NEW_IBAN, pm);
    const seen = (await pendingFor(pm, contactId)).find((row) => row.id === id);
    await stack.http.writeOk(
      FieldApprovalHandlers.rejectChange,
      { id, version: seen?.version },
      pm,
    );

    const raw = await selectMany<{ status: string }>(stack.db, fieldChangeRequestTable, { id });
    expect(raw[0]?.status).toBe("rejected");
    expect(await currentIban(contactId)).toBe(OLD_IBAN);
  });

  test("a request for a field without access.approve is refused", async () => {
    const contactId = await seedContact();
    const error = await stack.http.writeErr(
      FieldApprovalHandlers.requestChange,
      { entityType: "contact", entityId: contactId, fieldName: "name", value: "x" },
      pm,
    );
    expect(error.details).toMatchObject({ reason: "field_not_approval_gated" });
  });
});

describe("field-approval request ids", () => {
  test("a request row uses the deterministic id of its host record and field", async () => {
    const contactId = await seedContact();
    const { id } = await fileRequest(contactId, NEW_IBAN, pm);
    expect(id).toBe(fieldChangeRequestAggregateId(pm.tenantId, "contact", contactId, "iban"));
  });
});
