// subjectForgetAfterDeleteHook: the key erase is irreversible, so it must only happen once the
// delete (tenant scope, preDelete hooks) has accepted the row.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import {
  configurePiiSubjectKms,
  decryptPiiFieldValues,
  InMemoryKmsAdapter,
  PII_ERASED_SENTINEL,
  subjectIdToKey,
} from "@cosmicdrift/kumiko-framework/crypto";
import { buildEntityTable, createTenantDb, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineFeature,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { ConflictError } from "@cosmicdrift/kumiko-framework/errors";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { resetPiiSubjectKmsForTests, resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { SUBJECT_FORGOTTEN_EVENT_NAME } from "../constants.ts";
import { createCryptoShreddingFeature } from "../feature.ts";
import { subjectForgetAfterDeleteHook } from "../subject-forget-after-delete-hook.ts";

const ENTITY = "afterDeleteProbe";
const CREATE = "after-delete-probe:write:after-delete-probe:create";
const DELETE = "after-delete-probe:write:after-delete-probe:delete";
const TENANT: TenantId = testTenantId(31);
const OTHER_TENANT: TenantId = testTenantId(32);
const PLAINTEXT = "confidential lead note";

const owner = { id: "cccccccc-cccc-4ccc-8ccc-000000000031", tenantId: TENANT, roles: ["Owner"] };
const foreignOwner = {
  id: "cccccccc-cccc-4ccc-8ccc-000000000032",
  tenantId: OTHER_TENANT,
  roles: ["Owner"],
};

const probeEntity = createEntity({
  table: "read_after_delete_probe",
  fields: {
    body: createTextField({ required: true, maxLength: 200, personal: { of: "id" }, find: "none" }),
  },
});
const probeTable = buildEntityTable(ENTITY, probeEntity);
const access = { roles: ["Owner"] };

let rejectDelete = false;
let trailingSubjectIds: readonly string[] = [];

class FailingEraseKmsAdapter extends InMemoryKmsAdapter {
  readonly failingRecordIds = new Set<string>();

  override async eraseKey(...args: Parameters<InMemoryKmsAdapter["eraseKey"]>): Promise<void> {
    const [subject] = args;
    if (subject.kind === "record" && this.failingRecordIds.has(subject.id)) {
      throw new Error("kms unavailable for this subject");
    }
    await super.eraseKey(...args);
  }
}

const probeFeature = defineFeature("after-delete-probe", (r) => {
  const probe = r.entity({ name: ENTITY, ...probeEntity });
  r.writeHandler(defineEntityCreateHandler(ENTITY, probeEntity, { access }));
  r.writeHandler(defineEntityDeleteHandler(ENTITY, probeEntity, { access }));
  r.hook(
    subjectForgetAfterDeleteHook({
      target: { allOf: probe },
      subjectsOf: (id) =>
        [id, ...trailingSubjectIds].map((subjectId) => ({
          kind: "record" as const,
          entity: ENTITY,
          id: subjectId,
        })),
      reason: "probe row deleted: crypto-shred its note",
    }),
  );
  r.hook({
    type: "preDelete",
    target: `${ENTITY}:delete`,
    handler: async () => {
      if (rejectDelete) throw new ConflictError({ message: "delete rejected by hook" });
    },
  });
});

let stack: TestStack;
let kms: FailingEraseKmsAdapter;

beforeAll(async () => {
  stack = await setupTestStack({ features: [createCryptoShreddingFeature(), probeFeature] });
  await unsafeCreateEntityTable(stack.db, probeEntity, ENTITY);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [probeTable, eventsTable]);
  kms = new FailingEraseKmsAdapter();
  configurePiiSubjectKms(kms);
  rejectDelete = false;
  trailingSubjectIds = [];
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

async function createProbe(): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(CREATE, { body: PLAINTEXT }, owner);
  return created.id;
}

async function rawBodyOf(id: string): Promise<unknown> {
  const events = (await selectMany(stack.db, eventsTable, {
    aggregateId: id,
    type: `${ENTITY}.created`,
  })) as Array<{ payload: Record<string, unknown> }>;
  expect(events).toHaveLength(1);
  const decrypted = await decryptPiiFieldValues(
    { body: events[0]?.payload["body"] },
    ["body"],
    kms,
    { requestId: "test" },
  );
  return decrypted["body"];
}

async function rowCount(id: string): Promise<number> {
  const tenantDb = createTenantDb({
    db: stack.db,
    tenantId: TENANT,
    mode: "system",
    reason: "test inspects the probe table after delete",
  });
  return (await selectMany(tenantDb, probeTable, { id })).length;
}

describe("crypto-shredding :: subjectForgetAfterDeleteHook", () => {
  test("a successful delete removes the row and erases the key", async () => {
    const id = await createProbe();
    expect(await rawBodyOf(id)).toBe(PLAINTEXT);

    await stack.http.writeOk(DELETE, { id }, owner);

    expect(await rowCount(id)).toBe(0);
    expect(await rawBodyOf(id)).toBe(PII_ERASED_SENTINEL);
  });

  test("a rejecting preDelete hook keeps the row and its key: the PII stays readable", async () => {
    const id = await createProbe();
    rejectDelete = true;

    const response = await stack.http.write(DELETE, { id }, owner);

    expect(response.status).toBe(409);
    expect(await rowCount(id)).toBe(1);
    expect(await rawBodyOf(id)).toBe(PLAINTEXT);
  });

  test("a failing second subject rolls the delete back but keeps the audit event of the erased first subject", async () => {
    const id = await createProbe();
    const failingSubjectId = generateId();
    trailingSubjectIds = [failingSubjectId];
    kms.failingRecordIds.add(failingSubjectId);

    const response = await stack.http.write(DELETE, { id }, owner);

    // forget-subject's own key-store error reaches the caller instead of an anonymous internal error.
    expect(response.status).toBe(503);
    expect(await rowCount(id)).toBe(1);
    // The first key is gone for good, so its audit trail must outlive the rolled-back delete.
    expect(await rawBodyOf(id)).toBe(PII_ERASED_SENTINEL);
    const audit = (await selectMany(stack.db, eventsTable, {
      type: SUBJECT_FORGOTTEN_EVENT_NAME,
    })) as Array<{ payload: { subjectKey: string } }>;
    expect(audit).toHaveLength(1);
    expect(audit[0]?.payload.subjectKey).toBe(
      subjectIdToKey({ kind: "record", entity: ENTITY, id }),
    );
  });

  test("a refused forget surfaces as its own error, not as an anonymous internal error", async () => {
    const id = await createProbe();
    trailingSubjectIds = ["not-a-uuid"];

    const response = await stack.http.write(DELETE, { id }, owner);

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("validation_error");
    expect(await rowCount(id)).toBe(1);
  });

  test("a delete of another tenant's row is refused and never reaches the key erase", async () => {
    const id = await createProbe();

    const response = await stack.http.write(DELETE, { id }, foreignOwner);

    expect(response.status).not.toBe(200);
    expect(await rowCount(id)).toBe(1);
    expect(await rawBodyOf(id)).toBe(PLAINTEXT);
  });
});
