// A SystemAdmin whose session sits in another tenant may READ files of
// SYSTEM_TENANT_ID (meta, download, download-url); everything else stays
// tenant-equal. Real stack, real HTTP calls.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { SYSTEM_TENANT_ID } from "../../engine/types/index.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";
import { createFilesFeature } from "../feature.ts";
import { createLocalProvider } from "../local-provider.ts";

let stack: TestStack;
let storagePath: string;

const systemOwner = createTestUser({
  id: 10,
  tenantId: SYSTEM_TENANT_ID,
  roles: ["SystemAdmin"],
});
const systemAdminElsewhere = createTestUser({
  id: 11,
  tenantId: testTenantId(1),
  roles: ["SystemAdmin"],
});
const tenantAdmin = createTestUser({ id: 12, tenantId: testTenantId(1), roles: ["TenantAdmin"] });
const otherTenantAdmin = createTestUser({ id: 13, tenantId: testTenantId(2), roles: ["Admin"] });

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  storagePath = await mkdtemp(join(tmpdir(), "kumiko-system-tenant-file-"));
  stack = await setupTestStack({
    features: [createFilesFeature()],
    files: { storageProvider: createLocalProvider(storagePath) },
  });
});

afterAll(async () => {
  await stack.cleanup();
  await rm(storagePath, { recursive: true, force: true });
});

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 minimal");

async function upload(as: typeof systemOwner): Promise<string> {
  const token = await stack.jwt.sign(as);
  const fd = new FormData();
  fd.append("file", new File([Buffer.from(PDF_BYTES)], "report.pdf", { type: "application/pdf" }));
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function get(path: string, as: typeof systemOwner, method = "GET"): Promise<Response> {
  const token = await stack.jwt.sign(as);
  return stack.app.request(path, { method, headers: { Authorization: `Bearer ${token}` } });
}

describe("SystemAdmin reads SYSTEM_TENANT_ID files from any session", () => {
  test("meta and download work for a SystemAdmin in a normal tenant", async () => {
    const id = await upload(systemOwner);

    const meta = await get(`/api/files/${id}/meta`, systemAdminElsewhere);
    expect(meta.status).toBe(200);
    expect(((await meta.json()) as { fileName: string }).fileName).toBe("report.pdf");

    const download = await get(`/api/files/${id}`, systemAdminElsewhere);
    expect(download.status).toBe(200);
    expect(new TextDecoder().decode(await download.arrayBuffer())).toBe("%PDF-1.4 minimal");
  });

  test("a TenantAdmin of a normal tenant gets 404 for the same file", async () => {
    const id = await upload(systemOwner);
    expect((await get(`/api/files/${id}/meta`, tenantAdmin)).status).toBe(404);
    expect((await get(`/api/files/${id}`, tenantAdmin)).status).toBe(404);
  });

  test("a SystemAdmin does not read a file of another normal tenant", async () => {
    const id = await upload(otherTenantAdmin);
    expect((await get(`/api/files/${id}/meta`, systemAdminElsewhere)).status).toBe(404);
    expect((await get(`/api/files/${id}`, systemAdminElsewhere)).status).toBe(404);
  });

  test("a SystemAdmin in another tenant cannot delete a system file", async () => {
    const id = await upload(systemOwner);
    expect((await get(`/api/files/${id}`, systemAdminElsewhere, "DELETE")).status).toBe(404);
    expect((await get(`/api/files/${id}`, systemAdminElsewhere)).status).toBe(200);
  });
});
