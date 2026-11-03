// Anonymous visitors uploading into a field with anonymousUpload: what is accepted, how the body
// is capped, how often, and which 401 a visitor without a session sees. Real HTTP via setupTestStack.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { AUTH_COOKIE_BASE } from "../../api/session-cookies.ts";
import { selectMany } from "../../db/query.ts";
import { createFileField, defineFeature } from "../../engine/index.ts";
import { testTenantId } from "../../seeding/seed-users.ts";
import { createFilesFeature } from "../feature.ts";
import { fileRefsTable } from "../file-ref-table.ts";
import { ANONYMOUS_UPLOADS_PER_WINDOW } from "../file-routes.ts";
import { createInMemoryFileProvider } from "../in-memory-provider.ts";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 anonymous upload probe");
const SMALL_FIELD_LIMIT_KIB = 1;

const optInFeature = defineFeature("optin", (r) => {
  r.entity({
    name: "photo",
    table: "optin_photos",
    fields: {
      open: createFileField({ anonymousUpload: true, accept: ["pdf"], maxSize: "1kb" }),
      closed: createFileField({ accept: ["pdf"], maxSize: "50mb" }),
    },
  });
  r.writeHandler({
    name: "contact",
    schema: z.object({}),
    access: { roles: ["anonymous"] },
    handler: async () => ({ isSuccess: true as const, data: {} }),
  });
  r.screen({
    id: "contact-form",
    type: "actionForm",
    dormant: true,
    handler: "optin:write:contact",
    fields: { docs: createFileField({ accept: ["pdf"] }) },
    layout: { sections: [{ fields: ["docs"] }] },
  });
});

let stack: TestStack;
beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature(), optInFeature],
    files: { storageProvider: createInMemoryFileProvider() },
    anonymousAccess: { defaultTenantId: testTenantId(1) },
    trustedProxyHops: 1,
  });
});
afterAll(async () => {
  await stack.cleanup();
});
beforeEach(async () => {
  await stack.redis.flushNamespace();
});

async function anonymousUpload(
  fields: Record<string, string>,
  options: { readonly ip?: string; readonly cookie?: string; readonly data?: Uint8Array } = {},
): Promise<Response> {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.append(key, value);
  fd.append(
    "file",
    new File([Buffer.from(options.data ?? PDF_BYTES)], "doc.pdf", { type: "application/pdf" }),
  );
  const { body, contentType } = await buildMultipartBody(fd);
  return stack.app.request("/api/files", {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "x-forwarded-for": options.ip ?? "9.9.7.1",
      ...(options.cookie !== undefined && { Cookie: options.cookie }),
    },
    body,
  });
}

const openField = { entityType: "photo", fieldName: "open" };

describe("an anonymous upload", () => {
  test("a pending upload without entityId is stored", async () => {
    const res = await anonymousUpload(openField);
    expect(res.status).toBe(201);
    const stored = (await res.json()) as { id: string };
    const [row] = await selectMany(stack.db, fileRefsTable, { id: stored.id });
    expect(row).toMatchObject({ entityType: "photo", fieldName: "open", entityId: null });
  });

  test("a type the opted-in field does not accept is refused with 400", async () => {
    const fd = new FormData();
    for (const [key, value] of Object.entries(openField)) fd.append(key, value);
    fd.append("file", new File(["not a pdf"], "note.txt", { type: "text/plain" }));
    const { body, contentType } = await buildMultipartBody(fd);
    const res = await stack.app.request("/api/files", {
      method: "POST",
      headers: { "Content-Type": contentType, "x-forwarded-for": "9.9.7.2" },
      body,
    });
    expect(res.status).toBe(400);
  });

  test("a file above the opted-in field's maxSize is refused with 400", async () => {
    const data = new TextEncoder().encode(`%PDF-1.4 ${"x".repeat(SMALL_FIELD_LIMIT_KIB * 1024)}`);
    const storedBefore = await selectMany(stack.db, fileRefsTable, {});
    const res = await anonymousUpload(openField, { data });
    expect(res.status).toBe(400);
    expect(await selectMany(stack.db, fileRefsTable, {})).toHaveLength(storedBefore.length);
  });

  test("a body above the opted-in fields' cap never reaches the larger field's limit", async () => {
    const oversizedForAnonymous = new Uint8Array(512 * 1024);
    const storedBefore = await selectMany(stack.db, fileRefsTable, {});
    const asAnonymous = await anonymousUpload(openField, { data: oversizedForAnonymous });
    expect(asAnonymous.status).toBe(413);
    expect(await selectMany(stack.db, fileRefsTable, {})).toHaveLength(storedBefore.length);
  });

  test.each([
    ["a field without the opt-in", { entityType: "photo", fieldName: "closed" }],
    ["an entityId", { ...openField, entityId: "11111111-2222-4333-8444-555555555555" }],
    ["an actionForm", { actionForm: "optin:screen:contact-form", fieldName: "docs" }],
    ["no target", {}],
  ])("%s gets 401", async (_name, fields) => {
    const res = await anonymousUpload(fields);
    expect(res.status).toBe(401);
  });
});

describe("the 401 for an anonymous upload", () => {
  test("carries sign_in_required for a visitor who never had a session", async () => {
    const res = await anonymousUpload({});
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("sign_in_required");
  });

  test("carries the session-ended code when the visitor's session cookie is no longer valid", async () => {
    const res = await anonymousUpload({}, { cookie: `${AUTH_COOKIE_BASE}=stale-token` });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("unauthenticated");
  });
});

describe("anonymous upload rate limit", () => {
  test("the call over the per-IP limit answers 429; another IP keeps its own bucket", async () => {
    for (let i = 0; i < ANONYMOUS_UPLOADS_PER_WINDOW; i++) {
      expect((await anonymousUpload(openField, { ip: "9.9.7.3" })).status).toBe(201);
    }
    const blocked = await anonymousUpload(openField, { ip: "9.9.7.3" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).not.toBeNull();

    expect((await anonymousUpload(openField, { ip: "9.9.7.4" })).status).toBe(201);
  });
});
