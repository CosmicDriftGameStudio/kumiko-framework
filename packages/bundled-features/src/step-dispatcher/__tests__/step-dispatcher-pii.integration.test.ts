// step-dispatcher crypto-shredding (fw#2057): the dispatch-requested payload
// carries recipient/subject/body/url/headers as ciphertext under a
// per-dispatch record key; the dispatcher decrypts to send, then erases the
// key once the outcome is recorded — redelivery after that must be a no-op.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configurePiiSubjectKms,
  decryptPiiValueForSubject,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  KeyErasedError,
  PII_CIPHERTEXT_PREFIX,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  defineWriteHandler,
  stepsPipeline,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  resetEventStore,
  setupTestStack,
  type TestStack,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing";
import * as z from "zod";
import { createSecretsFeature } from "../../secrets/index.js";
import {
  createStepDispatcherFeature,
  type MailDispatchResult,
  type MailSpec,
  setMailRunner,
  setWebhookFetch,
  WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR,
} from "../index.js";

const DISPATCH_REQUESTED = "kumiko:system:step.dispatch-requested";
const DISPATCHED = "kumiko:system:step.dispatched";
const DISPATCH_FAILED = "kumiko:system:step.dispatch-failed";

const probeFeature = defineFeature("step-pii-probe", (r) => {
  r.requires.step("mail.send");
  r.requires.step("webhook.send");

  r.writeHandler(
    defineWriteHandler({
      name: "notify-mail",
      schema: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
      access: { roles: ["Admin"] },
      perform: stepsPipeline<{ to: string; subject: string; body: string }, { ok: true }>(
        ({ event, r }) => [
          r.step.mail.send({
            to: () => event.payload.to,
            subject: () => event.payload.subject,
            body: () => event.payload.body,
            mode: "deferred",
          }),
          r.step.return(() => ({ isSuccess: true as const, data: { ok: true as const } })),
        ],
      ),
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "notify-webhook",
      schema: z.object({ url: z.string(), token: z.string() }),
      access: { roles: ["Admin"] },
      perform: stepsPipeline<{ url: string; token: string }, { ok: true }>(({ event, r }) => [
        r.step.webhook.send({
          url: () => event.payload.url,
          headers: () => ({ "x-probe-token": event.payload.token }),
          body: () => ({ secretNote: "webhook-body-secret" }),
          mode: "deferred",
        }),
        r.step.return(() => ({ isSuccess: true as const, data: { ok: true as const } })),
      ]),
    }),
  );
});

const admin = createTestUser({ roles: ["Admin"] });
const fetchMock = mock<typeof fetch>();
const mailMock = mock<(spec: MailSpec) => Promise<MailDispatchResult>>();
const originalAllowedPrivateHostsEnv = process.env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR];

let stack: TestStack;
let kms: InMemoryKmsAdapter;

type EventRow = { aggregateId: string; payload: Record<string, unknown> };

async function eventsOfType(type: string): Promise<EventRow[]> {
  return (await selectMany(stack.db, eventsTable, { type })) as unknown as EventRow[];
}

async function drain(): Promise<void> {
  await stack.eventDispatcher?.runOnce();
}

async function requestedRow(): Promise<EventRow> {
  const rows = await eventsOfType(DISPATCH_REQUESTED);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

async function expectKeyErased(aggregateId: string): Promise<void> {
  await expect(
    kms.getKey({ kind: "record", entity: "step-dispatch", id: aggregateId }),
  ).rejects.toBeInstanceOf(KeyErasedError);
}

beforeAll(async () => {
  // hooks.example is a placeholder host — operator allowlist instead of DNS.
  process.env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = "hooks.example";
  setWebhookFetch(fetchMock as unknown as typeof fetch);
  setMailRunner(async (spec: MailSpec) => mailMock(spec));
  stack = await setupTestStack({
    features: [createStepDispatcherFeature(), createSecretsFeature(), probeFeature],
    systemHooks: [],
  });
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
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
  await resetEventStore(stack, []);
  await stack.redis.flushNamespace();
  await stack.eventDispatcher?.ensureRegistered();
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

const MAIL_INPUT = { to: "ops@example.com", subject: "Server down", body: "Disk is full" };

describe("step-dispatcher payload crypto-shredding", () => {
  test("mail.send: ciphertext at rest, plaintext to the runner, key erased after dispatched", async () => {
    await stack.http.writeOk("step-pii-probe:write:notify-mail", MAIL_INPUT, admin);

    const requested = await requestedRow();
    const keyPrefix = `${PII_CIPHERTEXT_PREFIX}record:step-dispatch:${requested.aggregateId}:`;
    for (const field of ["to", "subject", "body"]) {
      const stored = String(requested.payload[field]);
      expect(stored.startsWith(keyPrefix)).toBe(true);
    }
    expect(JSON.stringify(requested.payload)).not.toContain("ops@example.com");
    expect(JSON.stringify(requested.payload)).not.toContain("Disk is full");

    await drain();

    expect(mailMock).toHaveBeenCalledTimes(1);
    expect(mailMock).toHaveBeenCalledWith({
      to: "ops@example.com",
      subject: "Server down",
      body: "Disk is full",
    });
    expect(await eventsOfType(DISPATCHED)).toHaveLength(1);
    await expectKeyErased(requested.aggregateId);
    const afterErase = await decryptPiiValueForSubject(
      kms,
      String(requested.payload["to"]),
      { requestId: "test" },
      "to",
    );
    expect(afterErase).toBe(PII_ERASED_SENTINEL);
  });

  test("failed delivery erases the key too", async () => {
    mailMock.mockResolvedValue({ ok: false, error: "550 <ops@example.com> rejected" });
    await stack.http.writeOk("step-pii-probe:write:notify-mail", MAIL_INPUT, admin);
    const requested = await requestedRow();

    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      await drain();
    } finally {
      console.warn = originalWarn;
    }

    const mailFailureLogs = warnings.filter((args) => String(args[0]).includes("mail dispatch"));
    expect(mailFailureLogs).toHaveLength(1);
    expect(JSON.stringify(mailFailureLogs)).not.toContain("ops@example.com");
    expect(JSON.stringify(mailFailureLogs)).toContain("rejected");

    const failed = await eventsOfType(DISPATCH_FAILED);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.payload["error"]).toBe("mail delivery failed");
    expect(JSON.stringify(failed[0]?.payload)).not.toContain("ops@example.com");
    await expectKeyErased(requested.aggregateId);
  });

  test("redelivery after the erase neither re-sends nor throws nor records a second outcome", async () => {
    await stack.http.writeOk("step-pii-probe:write:notify-mail", MAIL_INPUT, admin);
    await drain();
    expect(mailMock).toHaveBeenCalledTimes(1);

    await asRawClient(stack.db).unsafe(
      `UPDATE kumiko_event_consumers SET last_processed_event_id = 0 WHERE name LIKE '%step-dispatcher%'`,
    );
    await drain();

    expect(mailMock).toHaveBeenCalledTimes(1);
    expect(await eventsOfType(DISPATCHED)).toHaveLength(1);
    expect(await eventsOfType(DISPATCH_FAILED)).toHaveLength(0);
  });

  test("a key erased before any outcome ends as a generic dispatch-failed, without sending", async () => {
    await stack.http.writeOk("step-pii-probe:write:notify-mail", MAIL_INPUT, admin);
    const requested = await requestedRow();
    await kms.eraseKey({ kind: "record", entity: "step-dispatch", id: requested.aggregateId });

    await drain();

    expect(mailMock).not.toHaveBeenCalled();
    const failed = await eventsOfType(DISPATCH_FAILED);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.payload["error"]).toBe(
      "dispatch payload erased before an outcome was recorded",
    );
  });

  test("ciphertext without a configured KMS ends as generic dispatch-failed", async () => {
    await stack.http.writeOk("step-pii-probe:write:notify-mail", MAIL_INPUT, admin);
    resetPiiSubjectKmsForTests();

    await drain();

    expect(mailMock).not.toHaveBeenCalled();
    const failed = await eventsOfType(DISPATCH_FAILED);
    expect(failed).toHaveLength(1);
    expect(JSON.stringify(failed[0]?.payload)).not.toContain("ops@example.com");
  });

  test("webhook.send: url, headers and body are ciphertext at rest and plaintext to fetch", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await stack.http.writeOk(
      "step-pii-probe:write:notify-webhook",
      { url: "https://hooks.example/secret-path", token: "probe-token" },
      admin,
    );

    const requested = await requestedRow();
    for (const field of ["url", "headersJson", "bodyJson"]) {
      expect(isPiiCiphertext(requested.payload[field])).toBe(true);
    }
    expect(JSON.stringify(requested.payload)).not.toContain("secret-path");
    expect(JSON.stringify(requested.payload)).not.toContain("probe-token");
    expect(JSON.stringify(requested.payload)).not.toContain("webhook-body-secret");

    await drain();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe("https://hooks.example/secret-path");
    expect(new Headers(init?.headers).get("x-probe-token")).toBe("probe-token");
    expect(JSON.parse(init?.body as string)).toEqual({ secretNote: "webhook-body-secret" });
    expect(await eventsOfType(DISPATCHED)).toHaveLength(1);
    await expectKeyErased(requested.aggregateId);
  });
});
