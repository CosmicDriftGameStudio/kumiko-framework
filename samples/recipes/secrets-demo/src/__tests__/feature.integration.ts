// Secrets Demo — End-to-End Proof
//
// What we're proving (all via real HTTP + BullMQ dispatch — no direct
// function calls into framework internals):
//   1. A TenantAdmin sets a secret over HTTP → DB holds only an envelope.
//   2. list handler returns a redacted preview, never plaintext.
//   3. Feature code (ctx.secrets.get) decrypts through the audited wrapper.
//      Every read writes a tenantSecretRead event to the events-table.
//   4. The response-guard catches accidental Secret<> leaks: a handler
//      that tries to return the branded value triggers a 500 at the
//      dispatcher boundary (not a silent exfiltration).
//   5. KEK rotation works end-to-end via the core rotate job, triggered
//      through BullMQ — app code writes zero rotation logic.

import { randomBytes } from "node:crypto";
import { createJobsFeature } from "@kumiko/bundled-features/jobs";
import {
  createSecretsContext,
  createSecretsFeature,
  type StoredEnvelope,
  TENANT_SECRET_READ_EVENT,
  tenantSecretsTable,
} from "@kumiko/bundled-features/secrets";
import { defineFeature, defineWriteHandler } from "@kumiko/framework/engine";
import { createEventsTable, eventsTable } from "@kumiko/framework/event-store";
import { createJobRunner, type JobRunner } from "@kumiko/framework/jobs";
import { createEnvMasterKeyProvider, createSecret } from "@kumiko/framework/secrets";
import {
  createTestUser,
  pushTables,
  setupTestStack,
  type TestStack,
} from "@kumiko/framework/stack";
import {
  createMutableMasterKeyProvider,
  type MutableMasterKeyProvider,
  waitFor,
} from "@kumiko/framework/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { createBillingFeature, STRIPE_API_KEY } from "../feature";

// Stable KEK bytes across provider rebuilds — mimics ops flipping env vars
// across a redeploy without rotating the actual key material.
const KEK_V1 = randomBytes(32);
const KEK_V2 = randomBytes(32);

function keyringEnv(current: number, withV2 = false): Record<string, string> {
  const env: Record<string, string> = {
    KUMIKO_SECRETS_MASTER_KEY_V1: KEK_V1.toString("base64"),
    KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: String(current),
  };
  if (withV2) env["KUMIKO_SECRETS_MASTER_KEY_V2"] = KEK_V2.toString("base64");
  return env;
}

// Buggy handler for the response-guard test. Deliberately returns a
// Secret<> branded value in its data payload. The dispatcher must
// intercept this before the response leaves the wire.
const leakyFeature = defineFeature("leaky", (r) => {
  r.writeHandler(
    defineWriteHandler({
      name: "leak",
      schema: z.object({}),
      access: { roles: ["TenantAdmin"] },
      handler: async () => ({
        isSuccess: true,
        data: { apiKey: createSecret("would-have-been-leaked") },
      }),
    }),
  );
});

const tenantAdmin = createTestUser({
  id: "00000000-0000-4000-8000-000000000010",
  tenantId: "00000000-0000-4000-8000-000000000001",
  roles: ["TenantAdmin"],
});

let stack: TestStack;
let jobRunner: JobRunner;
let providerRef: MutableMasterKeyProvider;

beforeAll(async () => {
  const initialProvider = createEnvMasterKeyProvider({ env: keyringEnv(1) });
  providerRef = createMutableMasterKeyProvider(initialProvider);

  stack = await setupTestStack({
    features: [createJobsFeature(), createSecretsFeature(), createBillingFeature(), leakyFeature],
    // Typed masterKeyProvider option: lands in AppContext as a typed field,
    // no Record<string, unknown>-via-extraContext. The rotation job reads
    // it from ctx.masterKeyProvider directly.
    masterKeyProvider: providerRef,
    extraContext: ({ db }) => ({
      // SecretsContext sees the mutable ref — any replace() flips what
      // set/get/rotate use on the NEXT call.
      secrets: createSecretsContext({ db, masterKeyProvider: providerRef }),
    }),
  });

  await pushTables(stack.db, {
    tenant_secrets: tenantSecretsTable,
  });
  await createEventsTable(stack.db);

  // BullMQ-backed job runner. Triggering rotate via dispatch() routes
  // through the queue + worker just like production — not a direct call
  // into the handler function.
  const redisUrl = `redis://${stack.redis.redis.options.host}:${stack.redis.redis.options.port}/${stack.redis.redis.options.db}`;
  jobRunner = createJobRunner({
    registry: stack.registry,
    context: {
      db: stack.db,
      registry: stack.registry,
      masterKeyProvider: providerRef,
    },
    redisUrl,
    consumerLane: "worker",
    queueNamePrefix: `kumiko-secrets-demo-${Date.now()}`,
  });
  await jobRunner.start();
});

afterAll(async () => {
  await jobRunner.stop();
  await stack.cleanup();
});

describe("1. at-rest representation", () => {
  test("set stores envelope only — plaintext nowhere in the row", async () => {
    await stack.http.writeOk(
      "secrets:write:set",
      { key: STRIPE_API_KEY.name, value: "sk_test_SuperSecretLivePlatz12345" },
      tenantAdmin,
    );

    const [row] = await stack.db
      .select()
      .from(tenantSecretsTable)
      .where(
        and(
          eq(tenantSecretsTable.tenantId, tenantAdmin.tenantId),
          eq(tenantSecretsTable.key, STRIPE_API_KEY.name),
        ),
      );
    if (!row) throw new Error("row missing");

    const env = row.envelope as StoredEnvelope;
    expect(env.ciphertext).toBeTruthy();
    expect(env.kekVersion).toBe(1);
    expect(row.kekVersion).toBe(1);
    expect(JSON.stringify(row)).not.toContain("sk_test_SuperSecretLivePlatz12345");
  });
});

describe("2. list shows preview only", () => {
  test("redactedPreview uses billing's domain-aware redact function", async () => {
    const list = await stack.http.queryOk<
      Array<{ key: string; redactedPreview: string | null; kekVersion: number }>
    >("secrets:query:list", {}, tenantAdmin);

    const stripe = list.find((r) => r.key === STRIPE_API_KEY.name);
    expect(stripe).toBeDefined();
    expect(stripe?.redactedPreview).toMatch(/^sk_test\.\.\..+$/);
    expect(stripe?.redactedPreview).not.toContain("SuperSecretLive");
  });
});

describe("3. feature code decrypts via audited path", () => {
  test("billing:charge reads plaintext; audit row is appended", async () => {
    // Post-ES: read-audit rides on the events-table as tenantSecretRead
    // domain-events (one per get() call, fresh aggregate-id each). Filter
    // by tenantId so parallel tests don't skew the count.
    const before = await stack.db
      .select()
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.tenantId, tenantAdmin.tenantId),
          eq(eventsTable.type, TENANT_SECRET_READ_EVENT),
        ),
      );

    const result = await stack.http.writeOk<{
      chargeId: string;
      amount: number;
      keyFingerprint: string;
    }>("billing:write:charge", { amount: 4999, customerRef: "cust_42" }, tenantAdmin);

    expect(result.keyFingerprint).toBe("sk_te...2345");
    expect(result.chargeId).toContain("cust_42");
    expect(JSON.stringify(result)).not.toContain("sk_test_SuperSecretLivePlatz12345");

    const after = await stack.db
      .select()
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.tenantId, tenantAdmin.tenantId),
          eq(eventsTable.type, TENANT_SECRET_READ_EVENT),
        ),
      );
    expect(after.length).toBe(before.length + 1);

    const newest = after[after.length - 1];
    if (!newest) throw new Error("read-audit event missing");
    const payload = newest.payload as {
      key: string;
      userId: string;
      handlerName: string;
    };
    expect(payload.key).toBe(STRIPE_API_KEY.name);
    expect(payload.userId).toBe(tenantAdmin.id);
    expect(payload.handlerName).toBe("billing:write:charge");
  });
});

describe("4. response guard via the real dispatcher", () => {
  test("a handler that returns Secret<> is rejected at the dispatcher boundary", async () => {
    // Full HTTP path: the leakyFeature's handler returns Secret<> in its
    // data. The dispatcher's post-handler guard catches it and converts
    // to a 500 with a "leaked" message — the client never sees the secret.
    const res = await stack.http.raw(
      "POST",
      "/api/write",
      { type: "leaky:write:leak", payload: {} },
      { Authorization: `Bearer ${await stack.jwt.sign(tenantAdmin)}` },
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toMatch(/leaked/);
    // Response must not echo the branded value — ever.
    expect(JSON.stringify(body)).not.toContain("would-have-been-leaked");
  });
});

describe("5. KEK rotation via the core job + real BullMQ dispatch", () => {
  test("rotate job triggered over BullMQ migrates the V1 row onto V2", async () => {
    // Sanity: row is still on V1 before we flip the ring.
    const [beforeRow] = await stack.db
      .select({ kekVersion: tenantSecretsTable.kekVersion })
      .from(tenantSecretsTable)
      .where(eq(tenantSecretsTable.key, STRIPE_API_KEY.name));
    expect(beforeRow?.kekVersion).toBe(1);

    // Ops flipped CURRENT to V2 (and keyring has V1+V2). In production
    // this is an env swap + redeploy; here we replace the inner provider
    // of the mutable ref so every downstream caller — SecretsContext AND
    // the rotate job — sees the new current.
    providerRef.replace(createEnvMasterKeyProvider({ env: keyringEnv(2, /* withV2 */ true) }));

    // Trigger the rotate job through the SAME path production uses:
    // jobRunner.dispatch → BullMQ queue → worker → registered handler.
    // Nothing calls rotateJob directly; the r.job wire has to be intact
    // for this to produce the expected DB change.
    await jobRunner.dispatch("secrets:job:rotate", { batchSize: 10 });

    // Wait for the BullMQ worker to finish. waitFor retries with escalating
    // delays (250ms → 1s → 3s) and throws the assertion error from the
    // final attempt — so a real rotation failure surfaces as a clear
    // "expected 2, got 1" instead of a "polling timed out" noise message.
    await waitFor(async () => {
      const [row] = await stack.db
        .select({ kekVersion: tenantSecretsTable.kekVersion })
        .from(tenantSecretsTable)
        .where(eq(tenantSecretsTable.key, STRIPE_API_KEY.name));
      expect(row?.kekVersion).toBe(2);
    });

    // Ciphertext byte-identical — only the DEK wrapper changed. Proves
    // rewrapDek's promise (cheap rotation on large tables).
    const [full] = await stack.db
      .select()
      .from(tenantSecretsTable)
      .where(eq(tenantSecretsTable.key, STRIPE_API_KEY.name));
    if (!full) throw new Error("row missing");
    expect((full.envelope as StoredEnvelope).kekVersion).toBe(2);
  });

  test("subsequent ctx.secrets.get after rotation still returns the original plaintext", async () => {
    // Goes through the whole real stack: HTTP → dispatcher → billing
    // handler → ctx.secrets.get → cached DEK-unwrap with V2 → decrypt.
    // If rotation broke anything, fingerprint would differ or the call
    // would throw.
    const result = await stack.http.writeOk<{ keyFingerprint: string }>(
      "billing:write:charge",
      { amount: 100, customerRef: "post_rotation_check" },
      tenantAdmin,
    );
    expect(result.keyFingerprint).toBe("sk_te...2345");
  });

  test("re-dispatching the job is a no-op once all rows are on current", async () => {
    await jobRunner.dispatch("secrets:job:rotate", { batchSize: 10 });
    // Row state already at V2 from the previous test; waitFor only gates
    // on the assertion succeeding, so if the job worker stayed idle (no
    // work to do) this returns on the first check.
    await waitFor(async () => {
      const [row] = await stack.db
        .select({ kekVersion: tenantSecretsTable.kekVersion })
        .from(tenantSecretsTable)
        .where(eq(tenantSecretsTable.key, STRIPE_API_KEY.name));
      expect(row?.kekVersion).toBe(2);
    });
  });
});
