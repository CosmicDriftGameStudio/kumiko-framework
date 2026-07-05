import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { publicShareTokenFeature, shareLinkEntity } from "../feature";

const TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;

let stack: TestStack;

const owner = createTestUser({ id: 1, tenantId: TENANT_ID, roles: ["TenantAdmin"] });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [publicShareTokenFeature],
    anonymousAccess: { defaultTenantId: TENANT_ID },
  });
  await unsafeCreateEntityTable(stack.db, shareLinkEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack?.cleanup();
});

describe("public-share-token recipe", () => {
  test("create → anonymous share-by-token returns payload", async () => {
    const created = await stack.http.writeOk<{
      id: string;
      plainToken: string;
    }>(
      "public-share:write:share-link:create",
      { label: "Demo", payload: { note: "hello" }, expiresInDays: 7 },
      owner,
    );

    expect(created.plainToken.startsWith("sh_")).toBe(true);

    const res = await stack.http.raw("POST", "/api/query", {
      type: "public-share:query:share-by-token",
      payload: { token: created.plainToken },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { label: string; payload: { note: string } } };
    expect(body.data.label).toBe("Demo");
    expect(body.data.payload.note).toBe("hello");
  });

  test("revoke → share-by-token 404", async () => {
    const created = await stack.http.writeOk<{ id: string; plainToken: string }>(
      "public-share:write:share-link:create",
      { label: "Revoke me", expiresInDays: 7 },
      owner,
    );

    await stack.http.writeOk("public-share:write:share-link:revoke", { id: created.id }, owner);

    const res = await stack.http.raw("POST", "/api/query", {
      type: "public-share:query:share-by-token",
      payload: { token: created.plainToken },
    });
    expect(res.status).toBe(404);
  });

  test("random token → 404", async () => {
    const res = await stack.http.raw("POST", "/api/query", {
      type: "public-share:query:share-by-token",
      payload: { token: "sh_not-a-real-token" },
    });
    expect(res.status).toBe(404);
  });
});
