// Proves the chat-channel path end to end: handler -> ctx.notify(route) ->
// delivery.send job (real BullMQ worker) -> tenant secret -> HTTP POST to a local
// stub standing in for Slack. Nothing real is contacted; the stub URL is only
// reachable because the app mounts the channel with an allowlist override.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createChannelSlackFeature } from "@cosmicdrift/kumiko-bundled-features/channel-slack";
import {
  configValuesTable,
  createConfigFeature,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createDeliveryFeature,
  createDeliveryTestContext,
  deliveryAttemptsTable,
} from "@cosmicdrift/kumiko-bundled-features/delivery";
import {
  createSecretsContext,
  createSecretsFeature,
  tenantSecretsTable,
} from "@cosmicdrift/kumiko-bundled-features/secrets";
import {
  createTenantFeature,
  TenantQueries,
  tenantEntity,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createJobRunner, type JobRunner } from "@cosmicdrift/kumiko-framework/jobs";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { waitFor } from "@cosmicdrift/kumiko-framework/testing";
import { OPS_ANNOUNCEMENT_TYPE, opsFeature } from "../feature";

const admin = createTestUser({ roles: ["Admin", "TenantAdmin"] });
const viewer = createTestUser({ roles: ["Viewer"] });

let stack: TestStack;
let jobRunner: JobRunner;
let stub: ReturnType<typeof Bun.serve>;
const received: unknown[] = [];

beforeAll(async () => {
  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl) throw new Error("REDIS_URL required for the async delivery recipe test");

  stub = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      received.push(await req.json());
      return new Response("ok");
    },
  });

  const masterKeyProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createSecretsFeature(),
      createDeliveryFeature(),
      createChannelSlackFeature({ allowedHosts: ["127.0.0.1"], requireHttps: false }),
      opsFeature,
    ],
    masterKeyProvider,
    extraContext: (deps) => {
      const secrets = createSecretsContext({ db: deps.db, masterKeyProvider });
      jobRunner = createJobRunner({
        registry: deps.registry,
        context: { db: deps.db, secrets },
        redisUrl,
        consumerLane: "worker",
        queueNamePrefix: `kumiko-chat-recipe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
      return {
        secrets,
        ...createDeliveryTestContext(deps, {
          tenantUserIdsQuery: TenantQueries.resolveUserIds,
          jobRunner,
        }),
      };
    },
  });
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    tenant_secrets: tenantSecretsTable,
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity, "tenant");
  await jobRunner.start();
});

afterAll(async () => {
  await jobRunner.stop();
  stub.stop(true);
  await stack.cleanup();
});

describe("chat-channels recipe", () => {
  test("announce -> Slack webhook receives the escaped text; log shows the connection name", async () => {
    // The tenant admin stores the webhook URL under the connection name.
    await stack.http.writeOk(
      "secrets:write:set",
      {
        key: "channel-slack:webhooks.ops",
        value: `http://127.0.0.1:${stub.port}/services/T000/B000/XXXX`,
      },
      admin,
    );

    await stack.http.writeOk(
      "ops:write:announce",
      { connection: "ops", title: "Deploy done", body: "release <v2> & friends" },
      admin,
    );

    await waitFor(
      async () => {
        const rows = await selectMany(db(), deliveryAttemptsTable, {
          notificationType: OPS_ANNOUNCEMENT_TYPE,
          channel: "slack",
        });
        expect(rows.some((r) => r["status"] === "sent")).toBe(true);
      },
      { delays: Array(40).fill(250) },
    );

    expect(received).toEqual([{ text: "Deploy done\nrelease &lt;v2&gt; &amp; friends" }]);
    const rows = await selectMany(db(), deliveryAttemptsTable, {
      notificationType: OPS_ANNOUNCEMENT_TYPE,
    });
    expect(rows.map((r) => r["recipientAddress"])).toEqual(["ops"]);
    expect(JSON.stringify(rows)).not.toContain("XXXX");
  }, 20000);

  test("announce rejects a caller without the Admin role", async () => {
    const attemptsBefore = await selectMany(db(), deliveryAttemptsTable, {
      notificationType: OPS_ANNOUNCEMENT_TYPE,
    });
    const error = await stack.http.writeErr(
      "ops:write:announce",
      { connection: "ops", title: "Not allowed" },
      viewer,
    );
    expect(error.code).toBe("access_denied");
    const attemptsAfter = await selectMany(db(), deliveryAttemptsTable, {
      notificationType: OPS_ANNOUNCEMENT_TYPE,
    });
    expect(attemptsAfter).toHaveLength(attemptsBefore.length);
  });
});

function db() {
  return stack.db;
}
