import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  filesStorageTrackingFeature,
} from "@cosmicdrift/kumiko-framework/files";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  buildMultipartBody,
  createTestEnvelopeCipher,
  patchFileInstanceofForBunTest,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { logAttempt } from "../../delivery/attempt-log.ts";
import { createDeliveryFeature } from "../../delivery/feature.ts";
import { deliveryAttemptsTable } from "../../delivery/tables.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { createUserFeature } from "../../user/feature.ts";
import { createSessionsFeature } from "../feature.ts";
import { USAGE_PROBE_QUERY, usageProbeAnswerSchema } from "../index.ts";

const PROBE_PATH = "/sessions/usage";
const SECRET = "u".repeat(40);
const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));

const extraContext = {
  configResolver: createConfigResolver({ cipher: encryption }),
  configEncryption: encryption,
};

async function probe(stack: TestStack, authorization?: string): Promise<Response> {
  return stack.http.raw("GET", PROBE_PATH, undefined, authorization ? { authorization } : {});
}

describe("sessions usage probe", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [
        createConfigFeature(),
        createUserFeature(),
        createTenantFeature(),
        createAuthFoundationFeature(),
        createSessionsFeature({ lastActivityProbeSecret: SECRET }),
      ],
      extraContext,
    });
  });
  afterAll(async () => {
    await stack.cleanup();
  });

  test("a wrong or missing secret gets 401", async () => {
    expect((await probe(stack)).status).toBe(401);
    expect((await probe(stack, "Bearer wrong")).status).toBe(401);
    expect((await probe(stack, `Bearer ${SECRET}x`)).status).toBe(401);
  });

  test("/api/query never answers the probe, not even with the right secret", async () => {
    const signedIn = await stack.http.query(
      USAGE_PROBE_QUERY,
      { bearerToken: SECRET },
      TestUsers.admin,
    );
    expect(signedIn.status).toBe(403);
    expect(await signedIn.text()).not.toContain("dbBytes");
  });

  test("the right secret returns the schema-conform usage; unmounted features answer null", async () => {
    const response = await probe(stack, `Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    const answer = usageProbeAnswerSchema.parse(await response.json());
    expect(answer.dbBytes).toBeGreaterThan(0);
    expect(answer.fileBytes).toBeNull();
    expect(answer.mailsSentThisMonth).toBeNull();
  });
});

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const SMALL = new Uint8Array([...PNG_SIGNATURE, ...Array(12).fill(0)]);
const LARGE = new Uint8Array([...PNG_SIGNATURE, ...Array(92).fill(0)]);

describe("sessions usage probe with files-storage-tracking and delivery mounted", () => {
  let stack: TestStack;

  async function upload(name: string, content: Uint8Array): Promise<void> {
    const token = await stack.jwt.sign(TestUsers.admin);
    const formData = new FormData();
    formData.append("file", new File([Buffer.from(content)], name, { type: "image/png" }));
    const { body, contentType } = await buildMultipartBody(formData);
    const res = await stack.app.request("/api/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
      body,
    });
    expect(res.status).toBe(201);
  }

  async function attempt(status: "sent" | "failed"): Promise<void> {
    await logAttempt(stack.db, stack.registry, {
      tenantId: TestUsers.admin.tenantId,
      notificationType: "usage-probe:test",
      channel: "email",
      recipientId: null,
      recipientAddress: "someone@example.com",
      status,
      error: status === "failed" ? "send_failed" : null,
      priority: "normal",
    });
  }

  beforeAll(async () => {
    patchFileInstanceofForBunTest();
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    stack = await setupTestStack({
      features: [
        createConfigFeature(),
        createUserFeature(),
        createTenantFeature(),
        createAuthFoundationFeature(),
        createFilesFeature(),
        filesStorageTrackingFeature,
        createDeliveryFeature(),
        createSessionsFeature({ lastActivityProbeSecret: SECRET }),
      ],
      extraContext,
      files: { storageProvider: createInMemoryFileProvider() },
    });
    await unsafePushTables(stack.db, { configValuesTable, deliveryAttemptsTable });
  });
  afterAll(async () => {
    await stack.cleanup();
    resetPiiSubjectKmsForTests();
  });

  test("fileBytes sums the tracked uploads and mails count only sent email this month", async () => {
    await upload("a.png", SMALL);
    await upload("b.png", LARGE);
    await stack.eventDispatcher?.runOnce();
    await attempt("sent");
    await attempt("sent");
    await attempt("failed");

    const response = await probe(stack, `Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    const answer = usageProbeAnswerSchema.parse(await response.json());
    expect(answer.fileBytes).toBe(SMALL.length + LARGE.length);
    expect(answer.mailsSentThisMonth).toBe(2);
  });
});
