// A provider that accepts a request without confirming delivery (Teams 202)
// leaves `confirmed=false` on the attempt row, on the inline path and through
// the real delivery.send job. Real stack, real HTTP, local stub for Teams.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  defineFeature,
  defineWriteHandler,
  type NotifyFn,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing";
import * as z from "zod";
import { createChannelTeamsFeature } from "../../channel-teams/feature.js";
import { createConfigFeature } from "../../config/feature.js";
import { configValuesTable } from "../../config/table.js";
import { createSecretsFeature } from "../../secrets/feature.js";
import { createSecretsContext } from "../../secrets/secrets-context.js";
import { tenantSecretsTable } from "../../secrets/table.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { tenantMembershipsTable } from "../../tenant/membership-table.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { DeliveryQueries } from "../constants.js";
import { createDeliveryFeature } from "../feature.js";
import { deliveryAttemptsTable } from "../tables.js";
import { createDeliveryTestContext } from "../testing.js";
import { type ProviderStub, startProviderStub } from "./chat-channel-harness.js";

const admin = createTestUser({ roles: ["TenantAdmin"] });

const probeFeature = defineFeature("confirmed-probe", (r) => {
  r.requires("delivery");
  r.writeHandler(
    defineWriteHandler({
      name: "ping",
      schema: z.object({
        notificationType: z.string(),
        connection: z.string(),
        immediate: z.boolean().optional(),
      }),
      access: { roles: ["TenantAdmin"] },
      handler: async (event, ctx) => {
        const notify = ctx.notify as NotifyFn;
        await notify(event.payload.notificationType, {
          route: { teams: event.payload.connection },
          data: { title: "ping" },
          ...(event.payload.immediate && { immediate: true }),
        });
        return { isSuccess: true, data: {} };
      },
    }),
  );
});

type AttemptRow = { readonly status: string; readonly confirmed: boolean | null };
type LogRow = { readonly type: string; readonly confirmed: boolean | null };

let stub: ProviderStub;
let stack: TestStack;

async function attemptFor(notificationType: string): Promise<AttemptRow | undefined> {
  const rows = await selectMany<AttemptRow>(stack.db, deliveryAttemptsTable, { notificationType });
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function ping(notificationType: string, connection: string, immediate = false) {
  await stack.http.writeOk(
    "confirmed-probe:write:ping",
    { notificationType, connection, immediate },
    admin,
  );
}

beforeAll(async () => {
  resetPiiSubjectKmsForTests();
  stub = startProviderStub();
  const masterKeyProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createSecretsFeature(),
      createTenantFeature(),
      createDeliveryFeature(),
      createChannelTeamsFeature({
        allowedHosts: ["127.0.0.1"],
        requireHttps: false,
        timeoutMs: 2000,
      }),
      probeFeature,
    ],
    masterKeyProvider,
    jobs: { consumerLane: "worker" },
    extraContext: (deps) => {
      const secrets = createSecretsContext({
        db: deps.db,
        masterKeyProvider,
        registry: deps.registry,
      });
      return { secrets, ...createDeliveryTestContext(deps, { secrets }) };
    },
  });
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    tenant_secrets: tenantSecretsTable,
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity, "tenant");
  for (const [connection, marker] of [
    ["accepted", "ACCEPTED202"],
    ["classic", "ONE200"],
  ] as const) {
    await stack.http.writeOk(
      "secrets:write:set",
      { key: `channel-teams:webhooks.${connection}`, value: `${stub.origin}/hooks/${marker}` },
      admin,
    );
  }
});

afterAll(async () => {
  stub.stop();
  await stack.cleanup();
});

describe("confirmed on the attempt row", () => {
  test("job path: a 202 ends sent + confirmed=false, delivery:query:log exposes it", async () => {
    await ping("app:notify:job-202", "accepted");
    expect((await attemptFor("app:notify:job-202"))?.status).toBe("queued");

    await stack.drainJobs();

    const row = await attemptFor("app:notify:job-202");
    expect(row?.status).toBe("sent");
    expect(row?.confirmed).toBe(false);
    const log = await stack.http.queryOk<{ rows: readonly LogRow[] }>(
      DeliveryQueries.log,
      { limit: 50 },
      admin,
    );
    expect(log.rows.find((r) => r.type === "app:notify:job-202")?.confirmed).toBe(false);
  });

  test("job path: a confirmed 200 leaves confirmed null", async () => {
    await ping("app:notify:job-200", "classic");
    await stack.drainJobs();

    const row = await attemptFor("app:notify:job-200");
    expect(row?.status).toBe("sent");
    expect(row?.confirmed).toBeNull();
    const log = await stack.http.queryOk<{ rows: readonly LogRow[] }>(
      DeliveryQueries.log,
      { limit: 50 },
      admin,
    );
    expect(log.rows.find((r) => r.type === "app:notify:job-200")?.confirmed).toBeNull();
  });

  test("inline path: a 202 writes confirmed=false", async () => {
    await ping("app:notify:inline-202", "accepted", true);

    const row = await attemptFor("app:notify:inline-202");
    expect(row?.status).toBe("sent");
    expect(row?.confirmed).toBe(false);
  });
});
