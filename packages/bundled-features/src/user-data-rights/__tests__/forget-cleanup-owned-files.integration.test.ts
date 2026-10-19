// runForgetCleanup also removes files of a userOwned file field that another user uploaded:
// the fileRef hook only sees files the forgotten user uploaded (insertedById).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { type DbConnection, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createFileField,
  createTextField,
  defineEntityCreateHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createInMemoryFileProvider,
  fileRefsTable,
  type InMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import {
  createDataRetentionFeature,
  tenantRetentionOverrideEntity,
} from "../../data-retention/index.ts";
import { createFilesFeature } from "../../files/index.ts";
import { createSessionsFeature, userSessionEntity } from "../../sessions/index.ts";
import { tenantMembershipEntity } from "../../tenant/membership-table.ts";
import { createUserFeature, userEntity, userTable } from "../../user/index.ts";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults/index.ts";
import { createUserDataRightsFeature } from "../feature.ts";
import { runForgetCleanup } from "../run-forget-cleanup.ts";
import { createForgetSeeders, type ForgetSeeders, nowInstant } from "./forget-test-helpers.ts";

const ownedDocEntity = createEntity({
  table: "read_ffc_owned_doc",
  fields: {
    ownerId: createTextField({ required: true, personal: false, reason: "pseudonymous_fk" }),
    contract: createFileField({ personal: { of: "ownerId" } }),
  },
});

const ownedDocFeature = defineFeature("ffc-probe", (r) => {
  r.entity({ name: "owned-doc", ...ownedDocEntity });
  r.writeHandler(
    defineEntityCreateHandler("owned-doc", ownedDocEntity, { access: { roles: ["Admin"] } }),
  );
});

const TENANT = "00000000-0000-4000-8000-00000000000e";
const FOREIGN_UPLOADER = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-0000000000f0",
  tenantId: TENANT,
  roles: ["Admin"],
};
const FOREIGN_OWNER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-0000000000f1";

function uuid(suffix: number): string {
  return `bbbbbbbb-bbbb-4bbb-8bbb-${suffix.toString(16).padStart(12, "0")}`;
}

let stack: TestStack;
let db: DbConnection;
let provider: InMemoryFileProvider;
let seed: ForgetSeeders;
let failDeletes = false;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  provider = createInMemoryFileProvider();
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createFilesFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature(),
      createUserDataRightsDefaultsFeature(),
      ownedDocFeature,
    ],
    files: { storageProvider: provider },
  });
  db = stack.db;
  seed = createForgetSeeders(db, provider);
  await unsafeCreateEntityTable(db, userEntity);
  await unsafeCreateEntityTable(db, userSessionEntity);
  await unsafeCreateEntityTable(db, tenantRetentionOverrideEntity);
  await unsafeCreateEntityTable(db, tenantMembershipEntity);
  await unsafeCreateEntityTable(db, ownedDocEntity, "owned-doc");
  await unsafePushTables(db, { fileRefsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  provider.clear();
  failDeletes = false;
  await resetTestTables(db, [
    userTable,
    "read_tenant_memberships",
    fileRefsTable,
    "read_ffc_owned_doc",
  ]);
});

// Storage resolver as the forget cron builds it, with a switch to make byte deletion fail.
const buildStorageProvider = async () => ({
  list: (prefix: string) => provider.list(prefix),
  delete: async (key: string) => {
    if (failDeletes) throw new Error("AccessDenied");
    return provider.delete(key);
  },
});

// Uploaded by someone other than the owner and bound by the entity save, as in production.
async function seedOwnedDoc(
  ownerId: string,
): Promise<{ readonly fileRefId: string; readonly key: string }> {
  const token = await stack.jwt.sign(FOREIGN_UPLOADER);
  const fd = new FormData();
  fd.append("entityType", "owned-doc");
  fd.append("fieldName", "contract");
  fd.append(
    "file",
    new File([Buffer.from("%PDF-1.4 minimal")], "contract.pdf", { type: "application/pdf" }),
  );
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  const { id: fileRefId } = (await res.json()) as { id: string };
  await stack.http.writeOk(
    "ffc-probe:write:owned-doc:create",
    { ownerId, contract: fileRefId },
    FOREIGN_UPLOADER,
  );
  const [ref] = await selectMany<{ storageKey: string; entityId: string | null }>(
    db,
    fileRefsTable,
    { id: fileRefId },
  );
  expect(ref?.entityId).not.toBeNull();
  return { fileRefId, key: String(ref?.storageKey) };
}

async function fileRefExists(id: string): Promise<boolean> {
  return (await selectMany(db, fileRefsTable, { id })).length > 0;
}

describe("runForgetCleanup :: userOwned files uploaded by someone else", () => {
  test("the forgotten user's owned file is gone (bytes + file_ref); another user's stays", async () => {
    const userId = uuid(1);
    await seed.seedForgetUser(userId);
    await seed.seedMembership(userId, TENANT);
    const { fileRefId: ownRef, key: ownKey } = await seedOwnedDoc(userId);
    const { fileRefId: otherRef, key: otherKey } = await seedOwnedDoc(FOREIGN_OWNER_ID);

    const result = await runForgetCleanup({
      db,
      registry: stack.registry,
      now: nowInstant(),
      buildStorageProvider,
    });

    expect(result.processedUserIds).toContain(userId);
    expect(await provider.exists(ownKey)).toBe(false);
    expect(await fileRefExists(ownRef)).toBe(false);
    expect(await provider.exists(otherKey)).toBe(true);
    expect(await fileRefExists(otherRef)).toBe(true);
  });

  test("a failing byte delete fails the user (stays DeletionRequested); the retry converges", async () => {
    const userId = uuid(2);
    await seed.seedForgetUser(userId);
    await seed.seedMembership(userId, TENANT);
    const { fileRefId, key } = await seedOwnedDoc(userId);
    failDeletes = true;

    const failed = await runForgetCleanup({
      db,
      registry: stack.registry,
      now: nowInstant(),
      buildStorageProvider,
    });
    expect(failed.processedUserIds).not.toContain(userId);
    expect(failed.errors.length).toBeGreaterThan(0);
    expect(await fileRefExists(fileRefId)).toBe(true);

    failDeletes = false;
    const retried = await runForgetCleanup({
      db,
      registry: stack.registry,
      now: nowInstant(),
      buildStorageProvider,
    });
    expect(retried.processedUserIds).toContain(userId);
    expect(await provider.exists(key)).toBe(false);
    expect(await fileRefExists(fileRefId)).toBe(false);
  });

  test("no storage resolvable: files are skipped (rows kept), the user is still processed", async () => {
    const userId = uuid(3);
    await seed.seedForgetUser(userId);
    await seed.seedMembership(userId, TENANT);
    const { fileRefId, key } = await seedOwnedDoc(userId);

    const result = await runForgetCleanup({ db, registry: stack.registry, now: nowInstant() });

    expect(result.processedUserIds).toContain(userId);
    expect(await provider.exists(key)).toBe(true);
    expect(await fileRefExists(fileRefId)).toBe(true);
  });
});
