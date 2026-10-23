// Event-shape contract for the tenantSecret aggregate + the
// tenantSecretRead side-stream. Executor-based writes (set/delete)
// produce auto-lifecycle events; get() writes a standalone read-audit
// event on a fresh aggregate-stream (one-event-per-read). This test
// pins both paths so a silent rename breaks here, not in a compliance
// audit query.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createEnvMasterKeyProvider,
  type MasterKeyProvider,
} from "@cosmicdrift/kumiko-framework/secrets";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createSecretsFeature } from "../feature.ts";
import {
  createSecretsContext,
  secretReadSchema,
  TENANT_SECRET_READ_EVENT,
} from "../secrets-context.ts";
import { tenantSecretsTable } from "../table.ts";
import { createDeclaredKeysFeature } from "./declared-keys-feature.ts";

const admin = createTestUser({
  id: "00000000-0000-4000-8000-000000000010",
  tenantId: "00000000-0000-4000-8000-000000000001",
  roles: ["TenantAdmin"],
});

const declared = createDeclaredKeysFeature();

let stack: TestStack;
let provider: MasterKeyProvider;

beforeAll(async () => {
  provider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });

  stack = await setupTestStack({
    features: [createSecretsFeature(), declared.feature],
    extraContext: ({ db, registry }) => ({
      secrets: createSecretsContext({ db, masterKeyProvider: provider, registry: registry }),
    }),
  });
  await unsafePushTables(stack.db, { tenantSecretsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [eventsTable, tenantSecretsTable]);
});

describe("tenantSecret lifecycle events", () => {
  test("set-then-list writes one tenantSecret.created event", async () => {
    await stack.http.writeOk(
      "secrets:write:set",
      { key: declared.keys.plain.name, value: "secret-value-xyz" },
      admin,
    );

    const created = await selectMany(stack.db, eventsTable, { type: "tenant-secret.created" });
    expect(created.length).toBe(1);
    // aggregateType stable; downstream MSPs filter by this.
    expect(created[0]?.aggregateType).toBe("tenant-secret");
    // Plaintext never lands on the event-stream — only the envelope.
    const serialized = JSON.stringify(created[0]?.payload);
    expect(serialized).not.toContain("secret-value-xyz");
  });

  test("delete writes a tenantSecret.deleted event on the same stream", async () => {
    await stack.http.writeOk(
      "secrets:write:set",
      { key: declared.keys.extra.name, value: "one-time" },
      admin,
    );
    await stack.http.writeOk("secrets:write:delete", { key: declared.keys.extra.name }, admin);

    const events = await selectMany(stack.db, eventsTable, { aggregateType: "tenant-secret" });

    // Exactly 2 events on the same aggregate-stream: created + deleted.
    expect(events.length).toBe(2);
    expect(events.map((e) => e.type)).toEqual(["tenant-secret.created", "tenant-secret.deleted"]);
    const ids = new Set(events.map((e) => e.aggregateId));
    expect(ids.size).toBe(1);
  });
});

describe("tenantSecretRead side-stream", () => {
  test("read-event type constant is stable", () => {
    // Downstream compliance exports match on this string. Silent rename
    // would cost audit continuity.
    expect(TENANT_SECRET_READ_EVENT).toBe("secrets:event:read");
  });

  test("read-audit payload conforms to secretReadSchema", () => {
    // Canonical shape — whoever touches the schema should update this
    // test in lockstep.
    expect(() =>
      secretReadSchema.parse({
        key: "example.key",
        userId: admin.id,
        handlerName: "billing:write:charge",
      }),
    ).not.toThrow();
  });
});
