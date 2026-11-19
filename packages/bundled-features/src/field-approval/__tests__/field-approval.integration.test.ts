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
  createSelectField,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createConfigFeature } from "../../config/feature.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { createUserFeature } from "../../user/feature.ts";
import { seedUser } from "../../user/seeding.ts";
import { fieldChangeRequestAggregateId } from "../aggregate-id.ts";
import {
  FIELD_APPROVAL_LIST_SCREEN_ID,
  FieldApprovalHandlers,
  FieldApprovalQueries,
} from "../constants.ts";
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
      searchable: true,
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
    accessPin: createTextField({
      personal: "tenant",
      find: "secret",
      writeOnly: true,
      access: { approve: ["Accountant"], write: ["PropertyManager", "Accountant"] },
    }),
    channel: createSelectField({
      options: ["mail", "phone"],
      default: "mail",
      access: { approve: ["Accountant"], write: ["PropertyManager", "Accountant"] },
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
    currentValue?: unknown;
    value: unknown;
    canApprove: boolean;
    filedByCaller?: boolean;
    requestedAt?: unknown;
    requestedByName?: unknown;
  }>;
};

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createUserFeature(),
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
  const detail = await stack.http.queryOk<Record<string, unknown>>(DETAIL, { id: contactId }, accA);
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

  test("create by a non-approver may keep a gated field's default but not choose another value", async () => {
    await stack.http.writeOk(CREATE, { name: "C", channel: "mail" }, pm);
    const refused = await stack.http.writeErr(CREATE, { name: "D", channel: "phone" }, pm);
    expect(refused.httpStatus).toBe(403);
    expect(refused.details).toMatchObject({
      reason: "field_approval_required",
      fields: ["channel"],
    });
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

  test("a requester who may not read the field sees the open request but not its value", async () => {
    const contactId = await seedContact();
    await stack.http.writeOk(
      FieldApprovalHandlers.requestChange,
      { entityType: "contact", entityId: contactId, fieldName: "bic", value: "COBADEFFXXX" },
      accA,
    );

    const row = (await pendingFor(accA, contactId)).find((r) => r.fieldName === "bic");
    expect(row).toMatchObject({ filedByCaller: true });
    expect(row?.value).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain("COBADEFFXXX");
  });

  test("a second request by the same requester replaces the open one instead of adding a row", async () => {
    const contactId = await seedContact();
    const first = await fileRequest(contactId, NEW_IBAN, pm);
    const second = await fileRequest(contactId, SECOND_IBAN, pm);
    expect(second.id).toBe(first.id);

    const rows = await pendingFor(accA, contactId);
    expect(rows.map((row) => row.value)).toEqual([SECOND_IBAN]);
    expect(rows[0]?.version).toBe(2);
    expect((await pendingFor(pm, contactId)).map((row) => row.value)).toEqual([SECOND_IBAN]);
    const raw = await selectMany(stack.db, fieldChangeRequestTable, { entityId: contactId });
    expect(raw).toHaveLength(1);
  });

  test("a second requester is refused while another's request is open; the first stays as filed", async () => {
    const contactId = await seedContact();
    const first = await fileRequest(contactId, NEW_IBAN, pm);

    const error = await stack.http.writeErr(
      FieldApprovalHandlers.requestChange,
      { entityType: "contact", entityId: contactId, fieldName: "iban", value: SECOND_IBAN },
      pm2,
    );

    expect(error.httpStatus).toBe(422);
    expect(error.details).toMatchObject({ reason: "field_change_request_pending_by_other" });
    const rows = await pendingFor(accA, contactId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: first.id,
      version: 1,
      value: NEW_IBAN,
      requestedBy: pm.id,
    });
  });

  test("an approver still writes the field directly while a request is open", async () => {
    const contactId = await seedContact();
    const { id } = await fileRequest(contactId, NEW_IBAN, pm);

    await stack.http.writeOk(
      UPDATE,
      { id: contactId, version: 1, changes: { iban: SECOND_IBAN } },
      accA,
    );

    expect(await currentIban(contactId)).toBe(SECOND_IBAN);
    // The direct write leaves the open request as it was; an approver still decides it.
    const raw = await selectMany<{ status: string }>(stack.db, fieldChangeRequestTable, { id });
    expect(raw[0]?.status).toBe("pending");
  });

  test("on the record, another requester's open request shows as open without value or name", async () => {
    const email = "pia.first@example.test";
    const seeded = await seedUser(stack.db, { email, displayName: "Pia First" });
    const firstRequester = createTestUser({ id: seeded.id, roles: ["PropertyManager"] });
    const contactId = await seedContact();
    const { id } = await fileRequest(contactId, NEW_IBAN, firstRequester);

    const rows = await pendingFor(pm2, contactId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      fieldName: "iban",
      canApprove: false,
      filedByCaller: false,
    });
    expect(rows[0]?.value).toBeUndefined();
    const json = JSON.stringify(rows);
    for (const leak of [NEW_IBAN, seeded.id, "Pia First", email]) {
      expect(json).not.toContain(leak);
    }
    expect(await pendingFor(viewer, contactId)).toEqual([]);
  });

  test("a request is stored encrypted and its value reaches only approvers and its requester", async () => {
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
    expect(JSON.stringify(await pendingFor(pm2, contactId))).not.toContain(NEW_IBAN);
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

describe("field-approval list", () => {
  test("a row names the record, the field label, old and new value, who and when", async () => {
    const contactId = await seedContact();
    const { id } = await fileRequest(contactId, NEW_IBAN, pm);
    const row = (await pendingFor(accA, contactId)).find((r) => r.id === id);
    expect(row).toMatchObject({
      recordLabel: "Owner",
      fieldName: "iban",
      fieldLabel: "fa-fixture:entity:contact:field:iban",
      currentValue: OLD_IBAN,
      value: NEW_IBAN,
      requestedBy: pm.id,
      canApprove: true,
      filedByCaller: false,
    });
    expect(typeof row?.requestedAt).toBe("string");
  });

  test("a writeOnly field shows neither its current nor its requested value in plaintext", async () => {
    const oldPin = "pin-old-4711";
    const newPin = "pin-new-0815";
    const created = await stack.http.writeOk<{ id: string }>(
      CREATE,
      { name: "Owner", accessPin: oldPin },
      accA,
    );
    await stack.http.writeOk(
      FieldApprovalHandlers.requestChange,
      { entityType: "contact", entityId: created.id, fieldName: "accessPin", value: newPin },
      pm,
    );

    for (const user of [accA, pm]) {
      const row = (await pendingFor(user, created.id)).find((r) => r.fieldName === "accessPin");
      expect(row).toMatchObject({ currentValue: true, value: true });
      expect(JSON.stringify(row)).not.toContain(oldPin);
      expect(JSON.stringify(row)).not.toContain(newPin);
    }
  });

  test("a requester sees the value of their own requests only, an approver all, a third role none", async () => {
    const pmContact = await seedContact();
    const pm2Contact = await seedContact();
    const pmRequest = await fileRequest(pmContact, NEW_IBAN, pm);
    const pm2Request = await fileRequest(pm2Contact, SECOND_IBAN, pm2);

    const valuesFor = async (user: typeof pm) =>
      [...(await pendingFor(user, pmContact)), ...(await pendingFor(user, pm2Contact))].map(
        (row) => [row.id, row.value],
      );
    expect(await valuesFor(pm)).toEqual([
      [pmRequest.id, NEW_IBAN],
      [pm2Request.id, undefined],
    ]);
    expect(await valuesFor(pm2)).toEqual([
      [pmRequest.id, undefined],
      [pm2Request.id, SECOND_IBAN],
    ]);
    expect(await valuesFor(accA)).toEqual([
      [pmRequest.id, NEW_IBAN],
      [pm2Request.id, SECOND_IBAN],
    ]);
    expect(await valuesFor(viewer)).toEqual([]);
  });

  test("an approver who is no admin sees the requester's display name, never the email", async () => {
    const email = "erika.requester@example.test";
    const seeded = await seedUser(stack.db, { email, displayName: "Erika Requester" });
    const requester = createTestUser({ id: seeded.id, roles: ["PropertyManager"] });
    const contactId = await seedContact();
    const { id } = await fileRequest(contactId, NEW_IBAN, requester);

    const row = (await pendingFor(accA, contactId)).find((r) => r.id === id);
    expect(row).toMatchObject({ requestedBy: seeded.id, requestedByName: "Erika Requester" });
    expect(JSON.stringify(row)).not.toContain(email);
  });

  test("an approver's own change offers no approve action and cannot be approved", async () => {
    const contactId = await seedContact();
    const { id } = await fileRequest(contactId, NEW_IBAN, accA);
    const row = (await pendingFor(accA, contactId)).find((r) => r.id === id);
    expect(row).toMatchObject({ canApprove: false, filedByCaller: true });

    const screen = createFieldApprovalFeature({ parents: ["contact"] }).screens[
      FIELD_APPROVAL_LIST_SCREEN_ID
    ];
    if (screen?.type !== "projectionList") throw new Error("expected the approval list screen");
    const approve = screen.rowActions?.find(
      (action) => "handler" in action && action.handler === FieldApprovalHandlers.approveChange,
    );
    expect(approve?.visible).toEqual({ field: "canApprove", eq: true });

    const error = await stack.http.writeErr(
      FieldApprovalHandlers.approveChange,
      { id, version: row?.version ?? 1 },
      accA,
    );
    expect(error.httpStatus).toBe(403);
    expect(await currentIban(contactId)).toBe(OLD_IBAN);
  });
});

describe("field-approval request ids", () => {
  test("a request row uses the deterministic id of its host record and field", async () => {
    const contactId = await seedContact();
    const { id } = await fileRequest(contactId, NEW_IBAN, pm);
    expect(id).toBe(fieldChangeRequestAggregateId(pm.tenantId, "contact", contactId, "iban"));
  });
});

describe("field-approval gated fields", () => {
  type GatedAnswer = PendingRows & { readonly gatedFields?: readonly string[] };
  const gatedFor = (user: typeof pm, entityId: string | null) =>
    stack.http.queryOk<GatedAnswer>(
      FieldApprovalQueries.pendingChanges,
      { entityType: "contact", entityId },
      user,
    );

  test("a writer without an approve role must request the gated fields, others must not", async () => {
    const contactId = await seedContact();
    expect((await gatedFor(pm, contactId)).gatedFields).toEqual([
      "iban",
      "bic",
      "accessPin",
      "channel",
    ]);
    expect((await gatedFor(accA, contactId)).gatedFields).toEqual([]);
    expect((await gatedFor(viewer, contactId)).gatedFields).toEqual([]);
  });

  test("a record not created yet has no requests but names the gated fields", async () => {
    const contactId = await seedContact();
    await fileRequest(contactId, NEW_IBAN, pm);
    expect(await gatedFor(pm, null)).toEqual({
      rows: [],
      gatedFields: ["iban", "bic", "accessPin", "channel"],
    });
  });

  test("without an entityType the list answers without gatedFields", async () => {
    const contactId = await seedContact();
    const { id } = await fileRequest(contactId, NEW_IBAN, pm);
    // Scoped to this record: earlier tests left requests whose subject keys are gone.
    const answer = await stack.http.queryOk<GatedAnswer>(
      FieldApprovalQueries.pendingChanges,
      { entityId: contactId },
      accA,
    );
    expect("gatedFields" in answer).toBe(false);
    expect(answer.rows.map((row) => row.id)).toContain(id);
  });
});
