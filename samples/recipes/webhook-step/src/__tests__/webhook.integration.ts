// webhook-step integration test — drives r.step.webhook.send end-to-end:
// handler appends step.dispatch-requested in TX, dispatcher subscription
// drains after COMMIT and calls the (stubbed) fetch, follow-up
// step.dispatched / step.dispatch-failed events land on the same stream.

import {
  createStepDispatcherFeature,
  type MailSpec,
  setMailRunner,
  setWebhookFetch,
} from "@cosmicdrift/kumiko-bundled-features/step-dispatcher";
import {
  createTestUser,
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { incidentEntity, incidentTable, webhookDemoFeature } from "../feature";

let stack: TestStack;
const admin = createTestUser({ roles: ["Admin"] });

const fetchMock = vi.fn<typeof fetch>();
const mailMock =
  vi.fn<
    (spec: { to: string | readonly string[]; subject: string; body: string }) => Promise<{
      ok: true;
      status: number;
    }>
  >();

beforeAll(async () => {
  setWebhookFetch(fetchMock);
  setMailRunner(async (spec: MailSpec) => mailMock(spec));
  stack = await setupTestStack({
    features: [createStepDispatcherFeature(), webhookDemoFeature],
    systemHooks: [],
  });
  await unsafeCreateEntityTable(stack.db, incidentEntity, "incident");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  fetchMock.mockReset();
  mailMock.mockReset();
  mailMock.mockResolvedValue({ ok: true, status: 202 });
  await resetEventStore(stack, ["read_webhook_demo_incidents"]);
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
    const [row] = await stack.db.select().from(incidentTable).where(eq(incidentTable.id, id));
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
    const [row] = await stack.db.select().from(incidentTable).where(eq(incidentTable.id, id));
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
    const rows = await stack.db.select().from(incidentTable);
    expect(rows).toHaveLength(0);
  });
});
