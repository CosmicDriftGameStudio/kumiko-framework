import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import {
  createChannelEmailFeature,
  createInMemoryTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { createDataRetentionFeature } from "@cosmicdrift/kumiko-bundled-features/data-retention";
import { createDeliveryFeature } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createFileFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import { createFileProviderInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/file-provider-inmemory";
import { createFilesFeature } from "@cosmicdrift/kumiko-bundled-features/files";
import { createNotesHistoryFeature } from "@cosmicdrift/kumiko-bundled-features/notes-history";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import { createTenantFeature } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createUserFeature } from "@cosmicdrift/kumiko-bundled-features/user";
import { createUserDataRightsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { contactFeature } from "../feature";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createDeliveryFeature(),
      createChannelEmailFeature({
        transport: createInMemoryTransport(),
        resolveEmail: async () => null,
      }),
      createFilesFeature(),
      createFileFoundationFeature(),
      createFileProviderInMemoryFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature(),
      createNotesHistoryFeature(),
      contactFeature,
    ],
    anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("contact sample", () => {
  test("an anonymous visitor gets a proof-of-work challenge and the form options", async () => {
    const res = await stack.http.raw("POST", "/api/query", {
      type: "contact:query:challenge",
      payload: {},
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { challenge: string; bits: number; phone: string } };
    expect(body.data.bits).toBe(8);
    expect(body.data.phone).toBe("optional");
    expect(body.data.challenge.length).toBeGreaterThan(0);
  });

  test("the browser client is served as JavaScript", async () => {
    const res = await stack.http.raw("GET", "/contact/client.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
    expect(await res.text()).toContain("KumikoContact");
  });
});
