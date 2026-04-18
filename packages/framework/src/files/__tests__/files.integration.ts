import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  type SessionUser,
} from "../../engine";
import { createEventsTable, loadAggregate } from "../../event-store";
import {
  createEntityTable,
  createTestDb,
  createTestUser,
  expectErrorIncludes,
  pushTables,
  type TestDb,
  TestUsers,
} from "../../testing";
import { fileRefsTable } from "../file-ref-table";
import { FILE_UPLOADED_EVENT_TYPE, type FileRoutesOptions } from "../file-routes";
import { createLocalProvider } from "../local-provider";
import { parseMaxSize, validateFile } from "../types";

// UUID for "this row doesn't exist" assertions. Valid v4 format so PG accepts
// the query — the row just isn't there. Pre-v1 files-feature tests used
// `99999` which Postgres now rejects with an invalid-uuid error.
const NONEXISTENT_UUID = "00000000-0000-4000-8000-999999999999";

// --- Setup ---

let testDb: TestDb;
let app: Hono;
let jwt: JwtHelper;
let storagePath: string;

const adminUser = TestUsers.admin;
const otherTenantUser = createTestUser({ id: 2, tenantId: "00000000-0000-4000-8000-000000000002" });
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
  await pushTables(testDb.db, { fileRefsTable });
  await createEntityTable(testDb.db, testTenantEntity);
  // Event-store table: the upload route appends files:event:uploaded in the
  // same tx as the FileRef insert. Without events, upload would 500.
  await createEventsTable(testDb.db);

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

async function getFile(user: SessionUser, fileId: string): Promise<Response> {
  const token = await jwt.sign(user);
  return app.request(`/api/files/${fileId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function getFileMeta(user: SessionUser, fileId: string): Promise<Response> {
  const token = await jwt.sign(user);
  return app.request(`/api/files/${fileId}/meta`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function deleteFile(user: SessionUser, fileId: string): Promise<Response> {
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
    expectErrorIncludes(error, "file_too_large");
  });

  test("validateFile rejects wrong extension", () => {
    const error = validateFile(
      { fileName: "doc.exe", mimeType: "application/exe", size: 100 },
      { accept: ["pdf", "jpg"] },
    );
    expectErrorIncludes(error, "invalid_file_type");
  });

  test("validateFile accepts valid file", () => {
    const error = validateFile(
      { fileName: "photo.jpg", mimeType: "image/jpeg", size: 500_000 },
      { maxSize: "2mb", accept: ["jpg", "png"] },
    );
    expect(error).toBeNull();
  });

  test("validateFile rejects MIME mismatch (extension says jpg, client claims PDF)", () => {
    const error = validateFile(
      { fileName: "sneaky.jpg", mimeType: "application/pdf", size: 500 },
      { accept: ["jpg", "png"] },
    );
    expectErrorIncludes(error, "mime_mismatch");
  });

  test("validateFile accepts jpeg mimeType variants for jpg extension", () => {
    expect(
      validateFile({ fileName: "a.jpg", mimeType: "image/jpeg", size: 100 }, { accept: ["jpg"] }),
    ).toBeNull();
    expect(
      validateFile({ fileName: "a.jpg", mimeType: "image/jpg", size: 100 }, { accept: ["jpg"] }),
    ).toBeNull();
  });
});

// --- Integration: Upload → Download → Delete via real HTTP API ---

describe("file upload flow via API", () => {
  let uploadedFileId: string;

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

  test("upload appends files:event:uploaded to the fileRef stream", async () => {
    // Load the full event stream for the just-uploaded FileRef. Phase 1
    // guarantees exactly one event per upload — "uploaded" at version 1.
    const events = await loadAggregate(testDb.db, uploadedFileId, adminUser.tenantId);

    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.type).toBe(FILE_UPLOADED_EVENT_TYPE);
    expect(event?.version).toBe(1);

    const payload = event?.payload as Record<string, unknown>;
    expect(payload["fileRefId"]).toBe(uploadedFileId);
    expect(payload["fileName"]).toBe("logo.png");
    expect(payload["mimeType"]).toBe("image/png");
    expect(payload["size"]).toBe(testPngContent.length);
    expect(payload["entityType"]).toBe("tenant");
    expect(payload["fieldName"]).toBe("logo");
    // The binary never hits the event — payload carries a pointer only.
    expect(payload["data"]).toBeUndefined();
    expect(payload["binary"]).toBeUndefined();
    expect(typeof payload["storageKey"]).toBe("string");
  });

  test("get file metadata", async () => {
    const res = await getFileMeta(adminUser, uploadedFileId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fileName).toBe("logo.png");
    expect(body.entityType).toBe("tenant");
    // entity_id is text post-migration — the upload route passes whatever
    // string the client sent (here "1") straight through.
    expect(body.entityId).toBe("1");
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

// --- Cross-user access within a tenant (attached file owner-scope) ---

describe("attached file owner-scope", () => {
  const testPng = new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...Array(50).fill(0),
  ]);
  // Same tenant as adminUser (tenantId 1), different id and no privileged role.
  const memberUser: SessionUser = {
    id: "11111111-0000-4000-8000-000000000042",
    tenantId: "00000000-0000-4000-8000-000000000001",
    roles: ["User"],
  };

  test("non-uploader, non-admin in same tenant cannot download an entity-attached file", async () => {
    const uploadRes = await uploadFile(memberUser, "mine.png", testPng, "image/png", {
      entityType: "tenant",
      entityId: "1",
      fieldName: "logo",
    });
    expect(uploadRes.status).toBe(201);
    const { id } = await uploadRes.json();

    // A different non-privileged user in the SAME tenant — the old code leaked
    // here (tenant check alone passed). New code rejects with 404.
    const otherMember: SessionUser = {
      id: "11111111-0000-4000-8000-000000000043",
      tenantId: "00000000-0000-4000-8000-000000000001",
      roles: ["User"],
    };
    const res = await getFile(otherMember, id);
    expect(res.status).toBe(404);
  });

  test("uploader can download their own entity-attached file", async () => {
    const uploadRes = await uploadFile(memberUser, "mine2.png", testPng, "image/png", {
      entityType: "tenant",
      entityId: "1",
      fieldName: "logo",
    });
    const { id } = await uploadRes.json();

    const res = await getFile(memberUser, id);
    expect(res.status).toBe(200);
  });

  test("Admin in same tenant can download any attached file", async () => {
    const uploadRes = await uploadFile(memberUser, "mine3.png", testPng, "image/png", {
      entityType: "tenant",
      entityId: "1",
      fieldName: "logo",
    });
    const { id } = await uploadRes.json();

    const res = await getFile(adminUser, id); // Admin role
    expect(res.status).toBe(200);
  });
});

// --- Custom access guard + privilegedRoles ---

describe("custom file access guard", () => {
  const testPng = new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...Array(30).fill(0),
  ]);

  // Spin up an isolated DB + storage dir for a single-test server. Runs the
  // body inside try/finally so the DB and tmpdir are cleaned up even if
  // assertions fail.
  async function withIsolatedFileServer(
    options: Omit<FileRoutesOptions, "db" | "storageProvider">,
    body: (args: {
      app: Hono;
      jwt: JwtHelper;
      upload: (user: SessionUser, name: string) => Promise<Response>;
      request: (user: SessionUser, fileId: string, init?: RequestInit) => Promise<Response>;
    }) => Promise<void>,
  ): Promise<void> {
    const isolatedDb = await createTestDb();
    await pushTables(isolatedDb.db, { fileRefsTable });
    await createEntityTable(isolatedDb.db, testTenantEntity);
    const storagePath = await mkdtemp(join(tmpdir(), "kumiko-files-custom-"));
    const provider = createLocalProvider(storagePath);
    const isolatedRegistry = createRegistry([tenantFeature]);
    const isolatedServer = buildServer({
      registry: isolatedRegistry,
      context: { db: isolatedDb.db },
      jwtSecret: JWT_SECRET,
      files: { db: isolatedDb.db, storageProvider: provider, ...options },
    });

    try {
      const upload = async (user: SessionUser, name: string) => {
        const token = await isolatedServer.jwt.sign(user);
        const fd = new FormData();
        fd.append("file", new File([Buffer.from(testPng)], name, { type: "image/png" }));
        fd.append("entityType", "tenant");
        fd.append("entityId", "1");
        fd.append("fieldName", "logo");
        return isolatedServer.app.request("/api/files", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
      };
      const request = async (user: SessionUser, fileId: string, init: RequestInit = {}) => {
        const token = await isolatedServer.jwt.sign(user);
        return isolatedServer.app.request(`/api/files/${fileId}`, {
          ...init,
          headers: {
            ...((init.headers as Record<string, string> | undefined) ?? {}),
            Authorization: `Bearer ${token}`,
          },
        });
      };
      await body({
        app: isolatedServer.app,
        jwt: isolatedServer.jwt,
        upload,
        request,
      });
    } finally {
      await isolatedDb.cleanup();
      await rm(storagePath, { recursive: true, force: true });
    }
  }

  test("privilegedRoles override: app-defined role (e.g. Supervisor) replaces the default Admin+SystemAdmin", async () => {
    await withIsolatedFileServer(
      { privilegedRoles: ["Supervisor"] },
      async ({ upload, request }) => {
        const uploader: SessionUser = {
          id: "11111111-0000-4000-8000-000000000010",
          tenantId: "00000000-0000-4000-8000-000000000001",
          roles: ["User"],
        };
        const supervisor: SessionUser = {
          id: "11111111-0000-4000-8000-000000000020",
          tenantId: "00000000-0000-4000-8000-000000000001",
          roles: ["Supervisor"],
        };
        const adminCaller: SessionUser = {
          id: "11111111-0000-4000-8000-000000000030",
          tenantId: "00000000-0000-4000-8000-000000000001",
          roles: ["Admin"],
        };

        const uploaded = await upload(uploader, "custom-role.png");
        const { id } = await uploaded.json();

        // Supervisor (the new privileged role) can read.
        expect((await request(supervisor, id)).status).toBe(200);
        // Admin is NO longer privileged under this config.
        expect((await request(adminCaller, id)).status).toBe(404);
      },
    );
  });

  test("custom accessGuard receives read/delete operation and can distinguish", async () => {
    const guardCalls: Array<{ operation: string; userId: string }> = [];
    await withIsolatedFileServer(
      {
        // Everyone in the tenant can read; only the uploader can delete.
        accessGuard: ({ fileRef, user, operation }) => {
          guardCalls.push({ operation, userId: user.id });
          if (operation === "read") return "allow";
          return fileRef.insertedById === user.id ? "allow" : "deny";
        },
      },
      async ({ upload, request }) => {
        const uploader: SessionUser = {
          id: "11111111-0000-4000-8000-000000000040",
          tenantId: "00000000-0000-4000-8000-000000000001",
          roles: ["User"],
        };
        const other: SessionUser = {
          id: "11111111-0000-4000-8000-000000000041",
          tenantId: "00000000-0000-4000-8000-000000000001",
          roles: ["User"],
        };

        const { id } = await (await upload(uploader, "guard.png")).json();

        // Other user can read (guard allowed).
        expect((await request(other, id)).status).toBe(200);
        // Other user cannot delete — guard denied.
        expect((await request(other, id, { method: "DELETE" })).status).toBe(404);
        // Uploader can delete.
        expect((await request(uploader, id, { method: "DELETE" })).status).toBe(200);

        expect(guardCalls.map((c) => c.operation)).toEqual(["read", "delete", "delete"]);
      },
    );
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
    // /files route uses its own lightweight error shape (plain string).
    expect(body.error).toContain("missing_file");
  });

  test("download non-existent file returns 404", async () => {
    const res = await getFile(adminUser, NONEXISTENT_UUID);
    expect(res.status).toBe(404);
  });

  test("delete non-existent file returns 404", async () => {
    const res = await deleteFile(adminUser, NONEXISTENT_UUID);
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
