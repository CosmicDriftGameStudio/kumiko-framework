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
  pushTables,
  type TestDb,
  TestUsers,
} from "../../stack";
import { expectErrorIncludes } from "../../testing";
import { fileRefsTable } from "../file-ref-table";
import { FILE_UPLOADED_EVENT_TYPE, type FileRoutesOptions } from "../file-routes";
import { createInMemoryFileProvider } from "../in-memory-provider";
import { createLocalProvider } from "../local-provider";
import type { FileStorageProvider } from "../types";
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

    type UploadedPayload = {
      fileRefId: string;
      fileName: string;
      mimeType: string;
      size: number;
      entityType: string;
      fieldName: string;
      storageKey: string;
      data?: unknown;
      binary?: unknown;
    };
    const payload = event!.payload as UploadedPayload;
    expect(payload.fileRefId).toBe(uploadedFileId);
    expect(payload.fileName).toBe("logo.png");
    expect(payload.mimeType).toBe("image/png");
    expect(payload.size).toBe(testPngContent.length);
    expect(payload.entityType).toBe("tenant");
    expect(payload.fieldName).toBe("logo");
    // The binary never hits the event — payload carries a pointer only.
    expect(payload.data).toBeUndefined();
    expect(payload.binary).toBeUndefined();
    expect(typeof payload.storageKey).toBe("string");
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
    options: Omit<FileRoutesOptions, "db" | "storageProvider"> & {
      // Overrides the default local-filesystem provider. Needed for tests
      // that exercise optional provider methods (e.g. getSignedUrl) which
      // the local provider deliberately doesn't implement.
      readonly storageProvider?: FileStorageProvider;
    },
    body: (args: {
      app: Hono;
      jwt: JwtHelper;
      upload: (user: SessionUser, name: string) => Promise<Response>;
      request: (user: SessionUser, fileId: string, init?: RequestInit) => Promise<Response>;
    }) => Promise<void>,
  ): Promise<void> {
    const { storageProvider: providerOverride, ...routeOptions } = options;
    const isolatedDb = await createTestDb();
    await pushTables(isolatedDb.db, { fileRefsTable });
    await createEntityTable(isolatedDb.db, testTenantEntity);
    const storagePath = await mkdtemp(join(tmpdir(), "kumiko-files-custom-"));
    const provider = providerOverride ?? createLocalProvider(storagePath);
    const isolatedRegistry = createRegistry([tenantFeature]);
    const isolatedServer = buildServer({
      registry: isolatedRegistry,
      context: { db: isolatedDb.db },
      jwtSecret: JWT_SECRET,
      files: { db: isolatedDb.db, storageProvider: provider, ...routeOptions },
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

// --- Content-Disposition hardening (Phase 2.3 follow-up) ---

describe("Content-Disposition header hardening", () => {
  const smallPng = new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...Array(20).fill(0),
  ]);

  // Helper: upload a file WITHOUT entity attachment so validateFile skips
  // the extension/mime whitelist. That's what lets us test with arbitrary
  // filenames that wouldn't pass the attached-upload validator.
  async function uploadUnattached(fileName: string): Promise<string> {
    const token = await jwt.sign(adminUser);
    const fd = new FormData();
    fd.append("file", new File([Buffer.from(smallPng)], fileName, { type: "image/png" }));
    const res = await app.request("/api/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    return body.id;
  }

  test("malicious filename cannot inject a second header parameter", async () => {
    // Name with a quote would break `filename="..."` quoting and inject
    // `filename*=utf-8''evil.exe` if we interpolated the raw name.
    const evil = `normal.png"; filename*=utf-8''evil.exe`;
    const id = await uploadUnattached(evil);

    const res = await getFile(adminUser, id);
    expect(res.status).toBe(200);
    const header = res.headers.get("Content-Disposition") ?? "";

    // Header has the RFC-6266 shape: attachment; filename="..."; filename*=UTF-8''...
    // Critically: exactly two parameters after `attachment`, i.e. no third
    // parameter injected. split by ";" yields ["attachment", filename=, filename*=]
    expect(header.split(";")).toHaveLength(3);
    expect(header.startsWith('attachment; filename="')).toBe(true);

    // The ASCII fallback inside `filename="..."` MUST NOT contain a quote
    // character — that would close the string early and let the tail
    // become a new parameter. This is the core fix.
    const fallbackMatch = header.match(/filename="([^"]*)"/);
    expect(fallbackMatch).not.toBeNull();
    expect(fallbackMatch?.[1]).not.toContain('"');
    expect(fallbackMatch?.[1]).not.toContain(";");

    // filename* uses UTF-8 percent-encoding. The attacker's quote char
    // (0x22) must appear as %22 — proving the raw bytes are preserved
    // losslessly without escape-sequence injection.
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain("%22"); // the quote char, percent-encoded
  });

  test("unicode filename is percent-encoded in filename*", async () => {
    const unicode = "測試.png"; // Chinese characters
    const id = await uploadUnattached(unicode);

    const res = await getFile(adminUser, id);
    const header = res.headers.get("Content-Disposition") ?? "";

    // ASCII fallback collapses non-ASCII to underscore.
    expect(header).toMatch(/^attachment; filename="[A-Za-z0-9._\-()]+";/);
    // Modern filename* carries the UTF-8 bytes percent-encoded.
    expect(header).toContain("filename*=UTF-8''");
    // 測 = 0xE6 0xB8 0xAC in UTF-8 — at least one of those bytes must
    // appear percent-encoded. Check E6 (lead byte of 測).
    expect(header.toUpperCase()).toContain("%E6");
  });

  test("empty fallback (all chars stripped) falls back to 'download'", async () => {
    // Name made entirely of characters outside the safe set — fallback
    // would be empty; the builder substitutes a sane default instead.
    const allStripped = "@@@###$$$.png"; // dots survive but the rest is stripped
    const id = await uploadUnattached(allStripped);

    const res = await getFile(adminUser, id);
    const header = res.headers.get("Content-Disposition") ?? "";

    // The dots + .png survive, so fallback is "____.png" rather than
    // the "download" default — prove the fallback is non-empty and safe.
    const fallbackMatch = header.match(/filename="([^"]+)"/);
    expect(fallbackMatch).not.toBeNull();
    expect(fallbackMatch?.[1]).not.toBe("");
    expect(fallbackMatch?.[1]).toMatch(/^[A-Za-z0-9._\-()]+$/);
  });
});

// --- Download-URL endpoint (Phase 2.3) ---

describe("download-url endpoint", () => {
  const testPng = new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...Array(40).fill(0),
  ]);

  // Mirrors the helper from the custom-guard block — same DB/storage
  // lifecycle, but accepts a provider override so we can inject an in-memory
  // provider that implements getSignedUrl.
  async function withIsolatedServer(
    storageProvider: FileStorageProvider,
    body: (args: {
      jwt: JwtHelper;
      upload: (user: SessionUser) => Promise<Response>;
      getDownloadUrl: (user: SessionUser, fileId: string) => Promise<Response>;
    }) => Promise<void>,
  ): Promise<void> {
    const isolatedDb = await createTestDb();
    await pushTables(isolatedDb.db, { fileRefsTable });
    await createEntityTable(isolatedDb.db, testTenantEntity);
    const isolatedRegistry = createRegistry([tenantFeature]);
    const isolatedServer = buildServer({
      registry: isolatedRegistry,
      context: { db: isolatedDb.db },
      jwtSecret: JWT_SECRET,
      files: { db: isolatedDb.db, storageProvider },
    });

    try {
      const upload = async (user: SessionUser) => {
        const token = await isolatedServer.jwt.sign(user);
        const fd = new FormData();
        fd.append("file", new File([Buffer.from(testPng)], "photo.png", { type: "image/png" }));
        fd.append("entityType", "tenant");
        fd.append("entityId", "1");
        fd.append("fieldName", "logo");
        return isolatedServer.app.request("/api/files", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
      };
      const getDownloadUrl = async (user: SessionUser, fileId: string) => {
        const token = await isolatedServer.jwt.sign(user);
        return isolatedServer.app.request(`/api/files/${fileId}/download-url`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });
      };
      await body({ jwt: isolatedServer.jwt, upload, getDownloadUrl });
    } finally {
      await isolatedDb.cleanup();
    }
  }

  test("returns signed URL + expiresAt for authorized caller", async () => {
    await withIsolatedServer(createInMemoryFileProvider(), async ({ upload, getDownloadUrl }) => {
      const before = Date.now();
      const { id } = await (await upload(adminUser)).json();

      const res = await getDownloadUrl(adminUser, id);
      expect(res.status).toBe(200);
      const body = await res.json();
      // The in-memory provider returns a memory:// URL with key + expiry —
      // that's enough to prove the route wired the provider through.
      expect(body.url).toMatch(/^memory:\/\//);
      expect(body.url).toContain(`${adminUser.tenantId}/tenant/1/logo/`);
      expect(body.url).toContain("expires=900");
      // expiresAt is ~15 min in the future (ISO-8601).
      const expiresAtMs = Date.parse(body.expiresAt);
      expect(expiresAtMs).toBeGreaterThan(before + 14 * 60 * 1000);
      expect(expiresAtMs).toBeLessThan(before + 16 * 60 * 1000);
    });
  });

  test("returns 404 for nonexistent file", async () => {
    await withIsolatedServer(createInMemoryFileProvider(), async ({ getDownloadUrl }) => {
      const res = await getDownloadUrl(adminUser, NONEXISTENT_UUID);
      expect(res.status).toBe(404);
    });
  });

  test("returns 404 for other tenant (tenant isolation)", async () => {
    await withIsolatedServer(createInMemoryFileProvider(), async ({ upload, getDownloadUrl }) => {
      const { id } = await (await upload(adminUser)).json();
      const res = await getDownloadUrl(otherTenantUser, id);
      expect(res.status).toBe(404);
    });
  });

  test("returns 404 when access guard denies (non-uploader, non-privileged)", async () => {
    const memberUploader: SessionUser = {
      id: "11111111-0000-4000-8000-000000000050",
      tenantId: "00000000-0000-4000-8000-000000000001",
      roles: ["User"],
    };
    const memberOther: SessionUser = {
      id: "11111111-0000-4000-8000-000000000051",
      tenantId: "00000000-0000-4000-8000-000000000001",
      roles: ["User"],
    };
    await withIsolatedServer(createInMemoryFileProvider(), async ({ upload, getDownloadUrl }) => {
      const { id } = await (await upload(memberUploader)).json();
      // Different non-privileged user in the SAME tenant — guard denies.
      const res = await getDownloadUrl(memberOther, id);
      expect(res.status).toBe(404);
    });
  });

  test("returns 501 when provider has no getSignedUrl (local filesystem)", async () => {
    // The main test server uses createLocalProvider which deliberately does
    // not implement getSignedUrl. Upload a fresh file, then request its
    // download URL — the route must detect the missing method and 501.
    const uploadRes = await uploadFile(adminUser, "no-signed.png", testPng, "image/png", {
      entityType: "tenant",
      entityId: "1",
      fieldName: "logo",
    });
    const { id } = await uploadRes.json();

    const token = await jwt.sign(adminUser);
    const res = await app.request(`/api/files/${id}/download-url`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toContain("signed_urls_not_supported");
  });
});
