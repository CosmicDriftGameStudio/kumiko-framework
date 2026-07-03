// Response-Tripwire (#820): ein kumiko-pii:-Ciphertext in einer JSON-Response
// ist immer ein Bug (raw-Read am Decrypt vorbei). Dev/Test → 500 (Test wird
// rot), Prod → redact + Error-Log, ohne KMS → kein Scan (pass-through).

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  resetPiiSubjectKmsForTests,
} from "../../crypto";
import { defineFeature } from "../../engine/define-feature";
import { defineQueryHandler } from "../../engine/define-handler";
import { setupTestStack, type TestStack, TestUsers } from "../../stack";

const CIPHERTEXT = "kumiko-pii:v1:user:6b2f4a0e-1c9d-4f3a-9d2e-00000000000a:8e2Rkjj+ww==";

const leakyFeature = defineFeature("leaky", (r) => {
  r.queryHandler(
    defineQueryHandler({
      name: "raw",
      schema: z.object({}),
      access: { openToAll: true },
      handler: async () => ({ email: CIPHERTEXT, note: "plain" }),
    }),
  );
  r.queryHandler(
    defineQueryHandler({
      name: "clean",
      schema: z.object({}),
      access: { openToAll: true },
      handler: async () => ({ email: "marc@example.com" }),
    }),
  );
});

let stack: TestStack;
const originalNodeEnv = process.env["NODE_ENV"];

beforeAll(async () => {
  stack = await setupTestStack({ features: [leakyFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
  if (originalNodeEnv === undefined) delete process.env["NODE_ENV"];
  else process.env["NODE_ENV"] = originalNodeEnv;
});

async function callLeakyQuery(): Promise<Response> {
  const token = await stack.jwt.sign(TestUsers.admin);
  return stack.http.raw(
    "POST",
    "/api/query",
    { type: "leaky:query:raw", payload: {} },
    { Authorization: `Bearer ${token}` },
  );
}

describe("piiCiphertextResponseGuard", () => {
  test("no KMS configured → response passes through unscanned", async () => {
    const res = await callLeakyQuery();
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(CIPHERTEXT);
  });

  test("KMS active, dev: leaking response becomes a loud 500", async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const res = await callLeakyQuery();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe("pii_ciphertext_leak");
    expect(body.error?.message).toContain("/api/query");
  });

  test("KMS active, production: leak is redacted, request succeeds", async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    process.env["NODE_ENV"] = "production";
    const res = await callLeakyQuery();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("kumiko-pii:");
    expect(text).toContain("[pii-redacted]");
    expect(text).toContain("plain");
  });

  test("KMS active, clean response stays untouched", async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const token = await stack.jwt.sign(TestUsers.admin);
    const res = await stack.http.raw(
      "POST",
      "/api/query",
      { type: "leaky:query:clean", payload: {} },
      { Authorization: `Bearer ${token}` },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("marc@example.com");
  });
});
