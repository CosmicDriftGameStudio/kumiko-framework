// Under an active subject KMS the event payload holds PII as ciphertext, which
// the API leak guard refuses to serve. Audit list/details must therefore return
// a placeholder instead of failing. Everything goes through real HTTP.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import {
  createEntity,
  createTextField,
  defineEntityWriteHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../../config/index.js";
import { REDACTED_PII_PLACEHOLDER } from "../../shared/index.js";
import { createTenantFeature } from "../../tenant/index.js";
import { createUserFeature } from "../../user/index.js";
import { AuditQueries } from "../constants.js";
import { createAuditFeature } from "../feature.js";

const memberEntity = createEntity({
  table: "audit_kms_members",
  fields: {
    ownerRef: createTextField({ personal: false, reason: "technical_reference" }),
    note: createTextField({ personal: { of: "ownerRef" }, find: "none" }),
  },
});

const memberFeature = defineFeature("auditkms", (r) => {
  r.entity({ name: "member", ...memberEntity });
  r.writeHandler(
    defineEntityWriteHandler("member:create", memberEntity, {
      access: { roles: ["Admin", "SystemAdmin"] },
    }),
  );
});

const SECRET = "very-secret-note";
const admin = TestUsers.systemAdmin;
let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      memberFeature,
      createAuditFeature(),
    ],
  });
  await unsafeCreateEntityTable(stack.db, memberEntity);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  resetPiiSubjectKmsForTests();
  await stack.cleanup();
});

describe("audit reads under an active subject KMS", () => {
  test("list and details return the placeholder instead of ciphertext or plaintext", async () => {
    await stack.http.writeOk(
      "auditkms:write:member:create",
      { ownerRef: "owner-1", note: SECRET },
      admin,
    );

    const list = await stack.http.queryOk<{
      rows: readonly { id: string; type: string; payload: Record<string, unknown> }[];
    }>(AuditQueries.list, {}, admin);
    const created = list.rows.find((r) => r.type === "member.created");
    if (!created) throw new Error("no member.created event in audit list");
    expect(JSON.stringify(list.rows)).not.toContain("kumiko-pii:");
    expect(JSON.stringify(list.rows)).not.toContain(SECRET);
    expect(JSON.stringify(created.payload)).toContain(REDACTED_PII_PLACEHOLDER);

    const details = await stack.http.queryOk<{ payload: Record<string, unknown> }>(
      AuditQueries.details,
      { id: created.id },
      admin,
    );
    const text = JSON.stringify(details.payload);
    expect(text).toContain(REDACTED_PII_PLACEHOLDER);
    expect(text).not.toContain("kumiko-pii:");
    expect(text).not.toContain(SECRET);
  });
});
