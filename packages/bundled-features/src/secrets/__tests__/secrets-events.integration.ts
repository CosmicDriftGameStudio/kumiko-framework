// Event-shape contract for the tenantSecret aggregate + the
// tenantSecretRead side-stream. Executor-based writes (set/delete)
// produce auto-lifecycle events; get() writes a standalone read-audit
// event on a fresh aggregate-stream (one-event-per-read). This test
// pins both paths so a silent rename breaks here, not in a compliance
// audit query.

import { randomBytes } from "node:crypto";
import { createEventsTable, eventsTable } from "@kumiko/framework/event-store";
import { createEnvMasterKeyProvider, type MasterKeyProvider } from "@kumiko/framework/secrets";
import {
  createTestUser,
  pushTables,
  setupTestStack,
  type TestStack,
} from "@kumiko/framework/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  createSecretsContext,
  secretReadSchema,
  TENANT_SECRET_READ_EVENT,
} from "../secrets-context";
import { createSecretsFeature } from "../secrets-feature";
import { tenantSecretsTable } from "../table";

const admin = createTestUser({
  id: "00000000-0000-4000-8000-000000000010",
  tenantId: "00000000-0000-4000-8000-000000000001",
  roles: ["TenantAdmin"],
});

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
    features: [createSecretsFeature()],
    extraContext: ({ db }) => ({
      secrets: createSecretsContext({ db, masterKeyProvider: provider }),
    }),
  });
  await pushTables(stack.db, { tenantSecretsTable });
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.db.delete(eventsTable);
  await stack.db.delete(tenantSecretsTable);
});

describe("tenantSecret lifecycle events", () => {
  test("set-then-list writes one tenantSecret.created event", async () => {
    await stack.http.writeOk(
      "secrets:write:set",
      { key: "example.api.key", value: "secret-value-xyz" },
      admin,
    );

    const created = await stack.db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.type, "tenantSecret.created"));
    expect(created.length).toBe(1);
    // aggregateType stable; downstream MSPs filter by this.
    expect(created[0]?.aggregateType).toBe("tenantSecret");
    // Plaintext never lands on the event-stream — only the envelope.
    const serialized = JSON.stringify(created[0]?.payload);
    expect(serialized).not.toContain("secret-value-xyz");
  });

  test("delete writes a tenantSecret.deleted event on the same stream", async () => {
    await stack.http.writeOk(
      "secrets:write:set",
      { key: "example.to.delete", value: "one-time" },
      admin,
    );
    await stack.http.writeOk("secrets:write:delete", { key: "example.to.delete" }, admin);

    const events = await stack.db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.aggregateType, "tenantSecret"));

    // Exactly 2 events on the same aggregate-stream: created + deleted.
    expect(events.length).toBe(2);
    expect(events.map((e) => e.type)).toEqual(["tenantSecret.created", "tenantSecret.deleted"]);
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
