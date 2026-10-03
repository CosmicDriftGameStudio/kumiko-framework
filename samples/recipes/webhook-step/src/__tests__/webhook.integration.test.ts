// webhook-step integration test — drives r.step.webhook.send end-to-end:
// handler appends step.dispatch-requested in TX, dispatcher subscription
// drains after COMMIT and calls the (stubbed) fetch, follow-up
// step.dispatched / step.dispatch-failed events land on the same stream.

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  createSecretsContext,
  createSecretsFeature,
  tenantSecretsTable,
} from "@cosmicdrift/kumiko-bundled-features/secrets";
import {
  createStepDispatcherFeature,
  type MailSpec,
  setMailRunner,
  setWebhookFetch,
  WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR,
} from "@cosmicdrift/kumiko-bundled-features/step-dispatcher";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createEnvMasterKeyProvider,
  type MasterKeyProvider,
} from "@cosmicdrift/kumiko-framework/secrets";
import {
  createTestUser,
  resetEventStore,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";

import { incidentEntity, incidentTable, webhookDemoFeature } from "../feature";

let stack: TestStack;
let masterKeyProvider: MasterKeyProvider;
const admin = createTestUser({ roles: ["Admin"] });

const TENANT_B = testTenantId(101);
const TENANT_A = testTenantId(102);
const TENANT_C = testTenantId(103);
const adminB = createTestUser({ id: 101, tenantId: TENANT_B, roles: ["Admin", "TenantAdmin"] });
const adminA = createTestUser({ id: 102, tenantId: TENANT_A, roles: ["Admin", "TenantAdmin"] });
const adminC = createTestUser({ id: 103, tenantId: TENANT_C, roles: ["Admin", "TenantAdmin"] });

const fetchMock = mock<typeof fetch>();
const mailMock =
  mock<
    (spec: { to: string | readonly string[]; subject: string; body: string }) => Promise<{
      ok: true;
      status: number;
    }>
  >();

const originalAllowedPrivateHostsEnv = process.env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR];

beforeAll(async () => {
  // hooks.example is a placeholder, not a real resolvable host — goes
  // through the operator escape hatch instead of a real DNS lookup.
  process.env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = "hooks.example";
  setWebhookFetch(fetchMock as unknown as typeof fetch);
  setMailRunner(async (spec: MailSpec) => mailMock(spec));
  masterKeyProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
  stack = await setupTestStack({
    features: [createStepDispatcherFeature(), createSecretsFeature(), webhookDemoFeature],
    systemHooks: [],
    extraContext: ({ db, registry }) => ({
      secrets: createSecretsContext({ db, masterKeyProvider, registry }),
    }),
  });
  await unsafeCreateEntityTable(stack.db, incidentEntity, "incident");
  await unsafePushTables(stack.db, { tenantSecretsTable });
});

afterAll(async () => {
  if (originalAllowedPrivateHostsEnv === undefined) {
    delete process.env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR];
  } else {
    process.env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = originalAllowedPrivateHostsEnv;
  }
  await stack.cleanup();
});

beforeEach(async () => {
  fetchMock.mockReset();
  mailMock.mockReset();
  mailMock.mockResolvedValue({ ok: true, status: 202 });
  await resetEventStore(stack, ["read_webhook_demo_incidents", tenantSecretsTable]);
  await stack.redis.flushNamespace();
  await stack.eventDispatcher?.ensureRegistered();
});

describe("webhook-step Sample", () => {
  test("incident:open writes aggregate AND fires webhook after COMMIT", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    const { id } = await stack.http.writeOk<{ id: string }>(
      "webhook-demo:write:incident:open",
      { title: "DB outage", severity: "high", webhookUrl: "https://hooks.example/incident" },
      admin,
    );

    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    // Aggregate landed
    const [row] = await selectMany(stack.db, incidentTable, { id });
    expect(row).toMatchObject({ title: "DB outage", severity: "high" });

    // Drain dispatcher (MSP runs async via runOnce in test mode)
    await stack.eventDispatcher?.runOnce();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe("https://hooks.example/incident");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({ event: "incident-opened", id, severity: "high" });
  });

  test("incident:notify-via-mail dispatches mail.send through the same MSP", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      "webhook-demo:write:incident:notify-via-mail",
      { to: "ops@example.com", title: "DB outage", severity: "high" },
      admin,
    );
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    await stack.eventDispatcher?.runOnce();

    expect(mailMock).toHaveBeenCalledTimes(1);
    expect(mailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "ops@example.com",
        subject: "Incident: DB outage",
        body: "Severity high",
      }),
    );
    // webhook didn't fire — different stepKind
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("incident:open-via-call invokes incident:open via callFeature and threads the result", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    const { id } = await stack.http.writeOk<{ id: string }>(
      "webhook-demo:write:incident:open-via-call",
      { title: "Network hiccup", severity: "low" },
      admin,
    );
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    // The inner incident:open ran and committed an aggregate
    const [row] = await selectMany(stack.db, incidentTable, { id });
    expect(row).toMatchObject({ title: "Network hiccup", severity: "low" });

    // And the inner handler's webhook fired
    await stack.eventDispatcher?.runOnce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("rollback: webhook does NOT fire when a later step throws", async () => {
    const res = await stack.http.write(
      "webhook-demo:write:incident:open-then-fail",
      { title: "should-rollback", webhookUrl: "https://hooks.example/never" },
      admin,
    );
    expect(res.status).toBe(500);

    await stack.eventDispatcher?.runOnce();

    expect(fetchMock).not.toHaveBeenCalled();
    const rows = await selectMany(stack.db, incidentTable);
    expect(rows).toHaveLength(0);
  });
});

describe("access-denied — role-restricted handlers", () => {
  test("incident:notify-via-mail rejects a caller without the Admin role", async () => {
    const viewer = createTestUser({ roles: ["User"] });

    const error = await stack.http.writeErr(
      "webhook-demo:write:incident:notify-via-mail",
      { to: "ops@example.com", title: "DB outage", severity: "high" },
      viewer,
    );
    expect(error.code).toBe("access_denied");
    await stack.eventDispatcher?.runOnce();
    expect(mailMock).not.toHaveBeenCalled();
  });

  test("incident:open-via-call rejects a caller without the Admin role", async () => {
    const viewer = createTestUser({ roles: ["User"] });

    const error = await stack.http.writeErr(
      "webhook-demo:write:incident:open-via-call",
      { title: "Network hiccup", severity: "low" },
      viewer,
    );
    expect(error.code).toBe("access_denied");
    const rows = await selectMany(stack.db, incidentTable, { title: "Network hiccup" });
    expect(rows).toHaveLength(0);
  });

  test("incident:open-then-fail rejects a caller without the Admin role", async () => {
    const viewer = createTestUser({ roles: ["User"] });

    const error = await stack.http.writeErr(
      "webhook-demo:write:incident:open-then-fail",
      { title: "should-not-run", webhookUrl: "https://hooks.example/never" },
      viewer,
    );
    expect(error.code).toBe("access_denied");
    await stack.eventDispatcher?.runOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("incident:open-authenticated — tenant-owned webhook auth secret", () => {
  test("a caller without the Admin role is rejected", async () => {
    const viewer = createTestUser({ roles: ["User"] });

    const error = await stack.http.writeErr(
      "webhook-demo:write:incident:open-authenticated",
      { title: "DB outage", severity: "high" },
      viewer,
    );
    expect(error.code).toBe("access_denied");
  });

  test("tenant B's own secret authenticates its own webhook", async () => {
    await stack.http.writeOk(
      "secrets:write:set",
      { key: "step-dispatcher:webhook-auth.incident-hook", value: "b-token-secret" },
      adminB,
    );
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await stack.http.writeOk<{ id: string }>(
      "webhook-demo:write:incident:open-authenticated",
      { title: "DB outage", severity: "high" },
      adminB,
    );
    await stack.eventDispatcher?.runOnce();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer b-token-secret");

    const dispatchedEvents = await selectMany(stack.db, eventsTable, {
      type: "kumiko:system:step.dispatched",
    });
    expect(dispatchedEvents).toHaveLength(1);
    const failedEvents = await selectMany(stack.db, eventsTable, {
      type: "kumiko:system:step.dispatch-failed",
    });
    expect(failedEvents).toHaveLength(0);
  });

  test("another tenant without a matching secret cannot ride tenant B's credential", async () => {
    await stack.http.writeOk(
      "secrets:write:set",
      { key: "step-dispatcher:webhook-auth.incident-hook", value: "b-token-secret" },
      adminB,
    );

    await stack.http.writeOk<{ id: string }>(
      "webhook-demo:write:incident:open-authenticated",
      {
        title: "Tenant A incident",
        severity: "high",
      },
      adminA,
    );
    await stack.eventDispatcher?.runOnce();

    expect(fetchMock).not.toHaveBeenCalled();

    const failedEvents = await selectMany(stack.db, eventsTable, {
      type: "kumiko:system:step.dispatch-failed",
    });
    expect(failedEvents).toHaveLength(1);
    const errorMessage = (failedEvents[0]?.payload as { error?: string } | null)?.error;
    expect(errorMessage).toBe("webhook auth secret is not available");
    expect(errorMessage).not.toContain("incident-hook");
    expect(errorMessage).not.toContain("b-token-secret");
  });

  test("a secret outside the webhook-auth namespace cannot be stored and does not authenticate", async () => {
    const rejected = await stack.http.writeErr(
      "secrets:write:set",
      { key: "incident-hook", value: "c-raw-token" },
      adminC,
    );
    expect(rejected.i18nKey).toBe("secrets.errors.unknownKey");

    await stack.http.writeOk<{ id: string }>(
      "webhook-demo:write:incident:open-authenticated",
      {
        title: "Tenant C incident",
        severity: "high",
      },
      adminC,
    );
    await stack.eventDispatcher?.runOnce();

    expect(fetchMock).not.toHaveBeenCalled();
    const failedEvents = await selectMany(stack.db, eventsTable, {
      type: "kumiko:system:step.dispatch-failed",
    });
    expect(failedEvents).toHaveLength(1);
  });
});
