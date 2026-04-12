import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { JwtHelper } from "../../api/jwt";
import { buildServer } from "../../api/server";
import {
  createEntity,
  createImageField,
  createRegistry,
  createTextField,
  defineFeature,
} from "../../engine";
import type { SessionUser } from "../../engine/types";
import { createEntityTable, createTestDb, type TestDb } from "../../testing";
import { FILE_REFS_TABLE_SQL } from "../file-ref-table";
import { createLocalProvider } from "../local-provider";
import { parseMaxSize, validateFile } from "../types";

// --- Setup ---

let testDb: TestDb;
let app: Hono;
let jwt: JwtHelper;
let storagePath: string;

const adminUser: SessionUser = { id: 1, tenantId: 1, roles: ["Admin"] };
const otherTenantUser: SessionUser = { id: 2, tenantId: 2, roles: ["Admin"] };
const JWT_SECRET = "files-test-secret-at-least-32-characters!!";

// A tenant feature with a logo field
const testTenantEntity = createEntity({
  table: "test_tenants",
  fields: {
    name: createTextField({ required: true }),
    logo: createImageField({ maxSize: "2mb", accept: ["png", "jpg"] }),
  },
});

const tenantFeature = defineFeature("tenant", (r) => {
  r.entity("tenant", testTenantEntity);
});

beforeAll(async () => {
  testDb = await createTestDb();
  storagePath = await mkdtemp(join(tmpdir(), "kumiko-files-test-"));

  // Create tables
  await testDb.db.execute(sql.raw(FILE_REFS_TABLE_SQL));
  await createEntityTable(testDb.db, testTenantEntity);

  const registry = createRegistry([tenantFeature]);
  const storageProvider = createLocalProvider(storagePath);

  const server = buildServer({
    registry,
    context: { db: testDb.db },
    jwtSecret: JWT_SECRET,
    files: { db: testDb.db, storageProvider },
  });
  app = server.app;
  jwt = server.jwt;
});

afterAll(async () => {
  await testDb.cleanup();
  await rm(storagePath, { recursive: true, force: true });
});

// --- Helpers ---

async function uploadFile(
  user: SessionUser,
  fileName: string,
  content: Uint8Array,
  mimeType: string,
  extra?: Record<string, string>,
): Promise<Response> {
  const token = await jwt.sign(user);
  const formData = new FormData();
  formData.append("file", new File([Buffer.from(content)], fileName, { type: mimeType }));
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      formData.append(k, v);
    }
  }
  return app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
}

async function getFile(user: SessionUser, fileId: number): Promise<Response> {
  const token = await jwt.sign(user);
  return app.request(`/api/files/${fileId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function getFileMeta(user: SessionUser, fileId: number): Promise<Response> {
  const token = await jwt.sign(user);
  return app.request(`/api/files/${fileId}/meta`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function deleteFile(user: SessionUser, fileId: number): Promise<Response> {
  const token = await jwt.sign(user);
  return app.request(`/api/files/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// --- Unit tests for validation helpers ---

describe("file validation", () => {
  test("parseMaxSize converts units correctly", () => {
    expect(parseMaxSize("1kb")).toBe(1024);
    expect(parseMaxSize("2mb")).toBe(2 * 1024 * 1024);
    expect(parseMaxSize("1gb")).toBe(1024 * 1024 * 1024);
  });

  test("parseMaxSize rejects invalid format", () => {
    expect(() => parseMaxSize("abc")).toThrow();
    expect(() => parseMaxSize("10")).toThrow();
  });

  test("validateFile rejects oversized files", () => {
    const error = validateFile(
      { fileName: "big.pdf", mimeType: "application/pdf", size: 3 * 1024 * 1024 },
      { maxSize: "2mb" },
    );
    expect(error).toContain("file_too_large");
  });

  test("validateFile rejects wrong extension", () => {
    const error = validateFile(
      { fileName: "doc.exe", mimeType: "application/exe", size: 100 },
      { accept: ["pdf", "jpg"] },
    );
    expect(error).toContain("invalid_file_type");
  });

  test("validateFile accepts valid file", () => {
    const error = validateFile(
      { fileName: "photo.jpg", mimeType: "image/jpeg", size: 500_000 },
      { maxSize: "2mb", accept: ["jpg", "png"] },
    );
    expect(error).toBeNull();
  });
});

// --- Integration: Upload → Download → Delete via real HTTP API ---

describe("file upload flow via API", () => {
  let uploadedFileId: number;

  // Create a small PNG-like test file
  const testPngContent = new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a, // PNG header
    ...Array(100).fill(0),
  ]);

  test("upload a logo image", async () => {
    const res = await uploadFile(adminUser, "logo.png", testPngContent, "image/png", {
      entityType: "tenant",
      entityId: "1",
      fieldName: "logo",
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.fileName).toBe("logo.png");
    expect(body.mimeType).toBe("image/png");
    expect(body.size).toBe(testPngContent.length);
    expect(body.storageKey).toContain("1/tenant/1/logo/");

    uploadedFileId = body.id;
  });

  test("download the uploaded file", async () => {
    const res = await getFile(adminUser, uploadedFileId);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Disposition")).toContain("logo.png");

    const downloaded = new Uint8Array(await res.arrayBuffer());
    expect(downloaded.length).toBe(testPngContent.length);
    expect(downloaded[0]).toBe(0x89); // PNG magic byte
  });

  test("get file metadata", async () => {
    const res = await getFileMeta(adminUser, uploadedFileId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fileName).toBe("logo.png");
    expect(body.entityType).toBe("tenant");
    expect(body.entityId).toBe(1);
    expect(body.fieldName).toBe("logo");
  });

  test("other tenant cannot access the file", async () => {
    const res = await getFile(otherTenantUser, uploadedFileId);
    expect(res.status).toBe(404);
  });

  test("delete the file", async () => {
    const res = await deleteFile(adminUser, uploadedFileId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // File is gone
    const getRes = await getFile(adminUser, uploadedFileId);
    expect(getRes.status).toBe(404);
  });
});

// --- Tenant isolation ---

describe("tenant isolation", () => {
  test("tenant 2 uploads a file, tenant 1 cannot see it", async () => {
    const content = new TextEncoder().encode("tenant2-secret-file");
    const uploadRes = await uploadFile(otherTenantUser, "secret.pdf", content, "application/pdf");
    expect(uploadRes.status).toBe(201);
    const { id } = await uploadRes.json();

    // Tenant 1 cannot access
    const getRes = await getFile(adminUser, id);
    expect(getRes.status).toBe(404);

    // Tenant 2 can access
    const getRes2 = await getFile(otherTenantUser, id);
    expect(getRes2.status).toBe(200);
  });
});

// --- Error handling ---

describe("error handling", () => {
  test("upload without file returns 400", async () => {
    const token = await jwt.sign(adminUser);
    const formData = new FormData();
    formData.append("notafile", "just text");

    const res = await app.request("/api/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("missing_file");
  });

  test("download non-existent file returns 404", async () => {
    const res = await getFile(adminUser, 99999);
    expect(res.status).toBe(404);
  });

  test("delete non-existent file returns 404", async () => {
    const res = await deleteFile(adminUser, 99999);
    expect(res.status).toBe(404);
  });

  test("upload wrong file type for entity field is rejected", async () => {
    const pdfContent = new TextEncoder().encode("fake-pdf-content");
    const res = await uploadFile(adminUser, "document.pdf", pdfContent, "application/pdf", {
      entityType: "tenant",
      entityId: "1",
      fieldName: "logo", // logo only accepts png, jpg
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("invalid_file_type");
  });

  test("upload without auth returns 401", async () => {
    const formData = new FormData();
    formData.append("file", new File([new Uint8Array(10)], "test.png", { type: "image/png" }));

    const res = await app.request("/api/files", {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(401);
  });
});
