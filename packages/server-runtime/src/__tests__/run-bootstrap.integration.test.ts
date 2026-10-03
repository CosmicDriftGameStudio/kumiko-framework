// runBootstrap against real Postgres + Redis: the worker-shaped boot, the
// delivery notify wiring and the composed invite flow together mail a real
// invitation; a second run is a no-op. Accept/login/403 are covered by
// bundled-features' bootstrap.integration.test.ts.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createChannelEmailFeature,
  createInMemoryTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import { createDeliveryFeature } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  createRendererSimpleFeature,
  simpleRenderer,
} from "@cosmicdrift/kumiko-bundled-features/renderer-simple";
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { tenantInvitationsTable, tenantTable } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-framework/stack";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { buildComposeAuthOptions, composeFeatures } from "../compose-features.js";
import { runBootstrap } from "../run-bootstrap.js";

const ADMIN_URL = process.env["TEST_DATABASE_URL"] ?? "";
const DB_NAME = `kumiko_runbootstrap_${Date.now().toString(36)}`;
const ROOT_EMAIL = "root@example.com";
const TENANT_ID = crypto.randomUUID() as TenantId;

const emailTransport = createInMemoryTransport();
const appFeatures = [
  createTemplateResolverFeature(),
  createRendererFoundationFeature(),
  createDeliveryFeature(),
  createRendererSimpleFeature(),
  createChannelEmailFeature({
    transport: emailTransport,
    renderer: simpleRenderer,
    resolveEmail: async () => "unused@test.local",
  }),
];
const auth = { invite: { appUrl: "https://app.example.com/invite/accept", tokenTtlMinutes: 5 } };

let schemaStack: TestStack;

beforeAll(async () => {
  if (!ADMIN_URL) throw new Error("TEST_DATABASE_URL must be set");
  // Only used to create the schema runBootstrap boots against.
  schemaStack = await setupTestStack({
    features: composeFeatures(appFeatures, {
      includeBundled: true,
      authOptions: buildComposeAuthOptions(auth) ?? {},
    }),
    dbName: DB_NAME,
  });
});

afterAll(async () => {
  await schemaStack.cleanup();
});

function bootstrapOnce() {
  return runBootstrap({
    features: appFeatures,
    migrations: false,
    allowPlaintextPii: "integration test",
    envSource: {
      DATABASE_URL: ADMIN_URL.replace(/\/[^/]+$/, `/${DB_NAME}`),
      REDIS_URL: process.env["REDIS_URL"] ?? "redis://localhost:16379",
      JWT_SECRET: "test-runbootstrap-secret-32-chars-min!",
    },
    auth,
    tenants: [{ id: TENANT_ID, key: `acme-${TENANT_ID.slice(0, 8)}`, name: "Acme" }],
    systemAdmins: [{ email: ROOT_EMAIL, tenantId: TENANT_ID, role: "TenantAdmin" }],
  });
}

describe("runBootstrap", () => {
  test("creates the tenant and mails the SystemAdmin invitation; a second run sends nothing", async () => {
    const first = await bootstrapOnce();
    expect(first?.tenants).toEqual([{ id: TENANT_ID, outcome: "created", seeded: false }]);
    expect(first?.invites.map((i) => i.outcome)).toEqual(["invited"]);
    expect(emailTransport.sent.map((m) => m.to)).toEqual([ROOT_EMAIL]);
    expect(emailTransport.sent[0]?.html).toContain("https://app.example.com/invite/accept?token=");

    expect(await selectMany(schemaStack.db, tenantTable, { id: TENANT_ID })).toHaveLength(1);
    const [invitation] = await selectMany(schemaStack.db, tenantInvitationsTable, {
      email: ROOT_EMAIL,
    });
    expect(parseRoles(invitation?.["globalRoles"])).toEqual(["SystemAdmin"]);

    const second = await bootstrapOnce();
    expect(second?.tenants).toEqual([{ id: TENANT_ID, outcome: "exists", seeded: false }]);
    expect(second?.invites.map((i) => i.outcome)).toEqual(["pending"]);
    expect(emailTransport.sent).toHaveLength(1);
  });
});
