import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { getUser } from "../api/auth-middleware";
import type { DbConnection } from "../db/connection";
import type { EventDef } from "../engine/types";
import { isFileField, type Registry, type SessionUser, type TenantId } from "../engine/types";
import { append as appendEvent } from "../event-store/event-store";
import { fileRefsTable } from "./file-ref-table";
import type { FileStorageProvider } from "./types";
import { buildStorageKey, validateFile } from "./types";

// Decision returned by a FileAccessGuard — distinct from boolean so callers
// can't accidentally negate or default it.
export type FileAccessDecision = "allow" | "deny";

export type FileRef = {
  id: string;
  tenantId: TenantId;
  storageKey: string;
  fileName: string;
  mimeType: string;
  size: number;
  entityType: string | null;
  entityId: string | null;
  fieldName: string | null;
  insertedById: string | null;
};

// Event emitted after a successful upload. Downstream hooks / MSPs subscribe
// on `fileUploadedEvent.name` via an r.multiStreamProjection apply map. The
// payload carries metadata + the storage key — never the binary itself.
// Consumers that need the bytes call `ctx.files.ref(payload.storageKey).read()`.
//
// Packaged as a framework-owned EventDef so consumers can narrow the raw
// StoredEvent.payload via `typedPayload(event, fileUploadedEvent)` instead
// of hand-casting. Schema version starts at 1; bump in lockstep with an
// r.eventMigration when the shape breaks.
export const fileUploadedPayloadSchema = z.object({
  fileRefId: z.uuid(),
  storageKey: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  fieldName: z.string().nullable(),
  insertedById: z.string().min(1),
});

export type FileUploadedPayload = z.infer<typeof fileUploadedPayloadSchema>;

export const fileUploadedEvent: EventDef<FileUploadedPayload> = {
  name: "files:event:uploaded",
  schema: fileUploadedPayloadSchema,
  version: 1,
};

// Convenience re-export so apps that only reach for the event name (e.g. as
// an apply-map key) don't have to dereference `.name` everywhere.
export const FILE_UPLOADED_EVENT_TYPE = fileUploadedEvent.name;

// Checks whether `user` may read/delete the given file. The default guard
// (ownerOrPrivilegedGuard) approves uploaders + any role in privilegedRoles.
// Apps can supply a custom guard to layer entity-level access (e.g. "drivers
// can read files attached to orders assigned to them").
export type FileAccessGuard = (args: {
  readonly fileRef: FileRef;
  readonly user: SessionUser;
  readonly operation: "read" | "delete";
}) => FileAccessDecision | Promise<FileAccessDecision>;

export type FileRoutesOptions = {
  readonly db: DbConnection;
  readonly storageProvider: FileStorageProvider;
  readonly registry?: Registry;
  readonly maxUploadSize?: string; // global default, e.g. "10mb"
  // Roles that bypass the default owner-check on entity-attached files.
  // Defaults to ["Admin", "SystemAdmin"]; override to match your app's roles.
  readonly privilegedRoles?: readonly string[];
  // Replaces the default guard entirely. When set, privilegedRoles is ignored
  // — the app takes full responsibility for the decision.
  readonly accessGuard?: FileAccessGuard;
};

const DEFAULT_PRIVILEGED_ROLES = ["Admin", "SystemAdmin"] as const;

// 15 minutes — long enough for a download to start, short enough that a
// leaked URL (e.g. from a browser history screenshot) isn't a long-lived
// credential. Matches the security-checklist in core-files.md.
const SIGNED_URL_DEFAULT_EXPIRY_SECONDS = 15 * 60;

// RFC-6266 + RFC-5987 compliant Content-Disposition builder.
//
// fileName comes from the client's multipart upload and is effectively
// attacker-controlled. A name like `foo.pdf"; filename*=utf-8''evil.exe`
// would break the `filename="..."` header quoting and inject a second
// parameter if we interpolated the raw string. Two-step fix:
//
//   1. ASCII fallback for `filename="..."` — strip anything outside a safe
//      token set, keeping the name readable for legacy clients that don't
//      understand RFC 5987.
//   2. Percent-encoded UTF-8 for `filename*=UTF-8''...` — the modern
//      parameter that every current browser honours. RFC 5987 requires a
//      handful of reserved chars that encodeURIComponent leaves alone
//      ('()*) to also be escaped.
function buildContentDispositionHeader(fileName: string): string {
  const asciiFallback = toAsciiFallback(fileName);
  const encoded = encodeRFC5987(fileName);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function toAsciiFallback(name: string): string {
  // Keep ASCII letters, digits, dot, dash, underscore, parens. Collapse
  // everything else (including quotes, backslashes, path separators,
  // control chars, and any non-ASCII) to underscore. Bounded length so a
  // giant client-supplied name can't balloon the header.
  const stripped = name.replace(/[^A-Za-z0-9.\-_()]/g, "_").slice(0, 100);
  return stripped.length > 0 ? stripped : "download";
}

function encodeRFC5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

// Default guard: on attached files, allow the uploader or a privileged role.
// Unattached files are tenant-wide (the tenant boundary is already enforced
// by the query).
function createDefaultGuard(privilegedRoles: readonly string[]): FileAccessGuard {
  return ({ fileRef, user }) => {
    if (fileRef.entityType === null || fileRef.entityId === null) return "allow";
    if (fileRef.insertedById === user.id) return "allow";
    for (const role of privilegedRoles) {
      if (user.roles.includes(role)) return "allow";
    }
    return "deny";
  };
}

export function createFileRoutes(options: FileRoutesOptions): Hono {
  const { db, storageProvider } = options;
  const privilegedRoles = options.privilegedRoles ?? DEFAULT_PRIVILEGED_ROLES;
  const guard: FileAccessGuard = options.accessGuard ?? createDefaultGuard(privilegedRoles);
  const api = new Hono();

  // POST /files — multipart upload.
  api.post("/files", async (c) => {
    const user = getUser(c);
    const body = await c.req.parseBody();
    const file = body["file"];

    if (!file || !(file instanceof File)) {
      return c.json({ error: "missing_file: expected multipart field 'file'" }, 400);
    }

    const entityType = typeof body["entityType"] === "string" ? body["entityType"] : undefined;
    // Post-ES migration entities use UUID ids; we accept the raw string and
    // store it in the text entityId column.
    const entityId = typeof body["entityId"] === "string" ? body["entityId"] : undefined;
    const fieldName = typeof body["fieldName"] === "string" ? body["fieldName"] : undefined;

    // Validate against entity field definition if available.
    let maxSize = options.maxUploadSize ?? "10mb";
    let accept: readonly string[] | undefined;

    if (options.registry && entityType && fieldName) {
      const entity = options.registry.getEntity(entityType);
      if (entity) {
        const fieldDef = entity.fields[fieldName];
        if (isFileField(fieldDef)) {
          if (fieldDef.maxSize) maxSize = fieldDef.maxSize;
          if (fieldDef.accept) accept = fieldDef.accept;
        }
      }
    }

    const validationError = validateFile(
      { fileName: file.name, mimeType: file.type, size: file.size },
      { maxSize, accept },
    );
    if (validationError) {
      return c.json({ error: validationError }, 400);
    }

    const fileRefId = uuid();
    const storageKey = buildStorageKey(
      user.tenantId,
      entityType ?? "unattached",
      entityId ?? "",
      fieldName ?? "file",
      file.name,
      uuid(),
    );

    // Write binary FIRST (outside the tx — network/disk I/O doesn't belong
    // inside a PG connection's tx window). On DB-tx rollback below the bytes
    // are orphaned in the provider; cleanup-jobs sweep those later. Losing a
    // row on append-failure is acceptable; corrupting a committed row with a
    // missing binary is not.
    const data = new Uint8Array(await file.arrayBuffer());
    await storageProvider.write(storageKey, data, file.type);

    // Atomic: insert FileRef + append files:event:uploaded in one tx. Either
    // both land or neither — no dangling FileRef without event, no event
    // referencing a row that doesn't exist.
    await db.transaction(async (tx) => {
      await tx.insert(fileRefsTable).values({
        id: fileRefId,
        tenantId: user.tenantId,
        storageKey,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        fieldName: fieldName ?? null,
        insertedById: user.id,
      });

      const payload: FileUploadedPayload = {
        fileRefId,
        storageKey,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        fieldName: fieldName ?? null,
        insertedById: user.id,
      };
      await appendEvent(tx, {
        aggregateId: fileRefId,
        aggregateType: "fileRef",
        tenantId: user.tenantId,
        expectedVersion: 0,
        type: fileUploadedEvent.name,
        // EventToAppend wants a Record — payload is typed through the
        // EventDef so the cast collapses to a single boundary, not a
        // double-`as unknown as` at the call site.
        payload: payload as Record<string, unknown>,
        metadata: { userId: user.id },
      });
    });

    return c.json(
      {
        id: fileRefId,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        storageKey,
      },
      201,
    );
  });

  // GET /files/:id — download.
  //
  // Authorization stack:
  //   1. tenantId must match (hard isolation, never crossable).
  //   2. The configured FileAccessGuard decides read access. Default:
  //      unattached → allow; attached → uploader or privileged role.
  //      Apps override via options.accessGuard to layer entity-level rules.
  api.get("/files/:id", async (c) => {
    const user = getUser(c);
    const id = c.req.param("id");
    const fileRef = await loadFileForTenant(id, user.tenantId);
    if (!fileRef) return c.json({ error: "not_found" }, 404);

    const decision = await guard({ fileRef, user, operation: "read" });
    if (decision === "deny") {
      // 404 rather than 403 so the existence of the file isn't confirmed to
      // an unauthorised caller — matches the tenant-miss response.
      return c.json({ error: "not_found" }, 404);
    }

    const data = await storageProvider.read(fileRef.storageKey);
    return new Response(Buffer.from(data), {
      headers: {
        "Content-Type": fileRef.mimeType,
        "Content-Disposition": buildContentDispositionHeader(fileRef.fileName),
        "Content-Length": String(fileRef.size),
      },
    });
  });

  // DELETE /files/:id — same guard, "delete" operation. Apps can differentiate
  // read vs delete in their custom guard (e.g. only uploaders delete).
  api.delete("/files/:id", async (c) => {
    const user = getUser(c);
    const id = c.req.param("id");
    const fileRef = await loadFileForTenant(id, user.tenantId);
    if (!fileRef) return c.json({ error: "not_found" }, 404);

    const decision = await guard({ fileRef, user, operation: "delete" });
    if (decision === "deny") return c.json({ error: "not_found" }, 404);

    await storageProvider.delete(fileRef.storageKey);
    await db.delete(fileRefsTable).where(eq(fileRefsTable.id, id));
    return c.json({ ok: true });
  });

  // GET /files/:id/download-url — returns a short-lived provider URL so the
  // client can download directly (offloads bandwidth from the API, enables
  // browser caching). Same auth + tenant + guard as GET /files/:id; the
  // signed URL is only handed out after access is approved.
  //
  // Shape: JSON { url, expiresAt } rather than a 302 redirect. Redirects
  // break browser `fetch()` on cross-origin URLs (CORS preflight semantics)
  // and hide the expiry from the caller — JSON lets SPAs cache the URL
  // until `expiresAt` without re-hitting the API.
  //
  // 501 when the wired provider doesn't support signed URLs (filesystem
  // dev providers). Clients should fall back to the streaming endpoint.
  api.get("/files/:id/download-url", async (c) => {
    if (!storageProvider.getSignedUrl) {
      return c.json(
        {
          error:
            "signed_urls_not_supported: this provider does not support signed URLs — use GET /files/:id to stream",
        },
        501,
      );
    }

    const user = getUser(c);
    const id = c.req.param("id");
    const fileRef = await loadFileForTenant(id, user.tenantId);
    if (!fileRef) return c.json({ error: "not_found" }, 404);

    const decision = await guard({ fileRef, user, operation: "read" });
    if (decision === "deny") return c.json({ error: "not_found" }, 404);

    const expiresInSeconds = SIGNED_URL_DEFAULT_EXPIRY_SECONDS;
    const url = await storageProvider.getSignedUrl(fileRef.storageKey, expiresInSeconds, {
      // Hint the provider to set Content-Disposition so the browser prompts
      // with the original filename instead of the UUID-based storage key.
      // Sanitised via buildContentDispositionHeader — the same attacker-
      // controlled fileName reaches the provider's presigned response.
      contentDisposition: buildContentDispositionHeader(fileRef.fileName),
    });
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    return c.json({ url, expiresAt });
  });

  // GET /files/:id/meta — metadata without the bytes. Guarded exactly like
  // download (meta leaks fileName/mimeType/size).
  api.get("/files/:id/meta", async (c) => {
    const user = getUser(c);
    const id = c.req.param("id");
    const fileRef = await loadFileForTenant(id, user.tenantId);
    if (!fileRef) return c.json({ error: "not_found" }, 404);

    const decision = await guard({ fileRef, user, operation: "read" });
    if (decision === "deny") return c.json({ error: "not_found" }, 404);

    return c.json({
      id: fileRef.id,
      fileName: fileRef.fileName,
      mimeType: fileRef.mimeType,
      size: fileRef.size,
      entityType: fileRef.entityType,
      entityId: fileRef.entityId,
      fieldName: fileRef.fieldName,
    });
  });

  async function loadFileForTenant(id: string, tenantId: TenantId): Promise<FileRef | null> {
    const [row] = await db
      .select()
      .from(fileRefsTable)
      .where(and(eq(fileRefsTable.id, id), eq(fileRefsTable.tenantId, tenantId)));
    return (row as FileRef | undefined) ?? null;
  }

  return api;
}
