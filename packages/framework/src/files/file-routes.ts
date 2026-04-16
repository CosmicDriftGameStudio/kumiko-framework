import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import { getUser } from "../api/auth-middleware";
import type { DbConnection } from "../db/connection";
import type { FieldDefinition, Registry, SessionUser } from "../engine/types";
import { fileRefsTable } from "./file-ref-table";
import type { FileStorageProvider } from "./types";
import { buildStorageKey, validateFile } from "./types";

// Decision returned by a FileAccessGuard — distinct from boolean so callers
// can't accidentally negate or default it.
export type FileAccessDecision = "allow" | "deny";

export type FileRef = {
  id: number;
  tenantId: number;
  storageKey: string;
  fileName: string;
  mimeType: string;
  size: number;
  entityType: string | null;
  entityId: number | null;
  fieldName: string | null;
  insertedById: number | null;
};

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
    const entityId = typeof body["entityId"] === "string" ? Number(body["entityId"]) : undefined;
    const fieldName = typeof body["fieldName"] === "string" ? body["fieldName"] : undefined;

    // Validate against entity field definition if available.
    let maxSize = options.maxUploadSize ?? "10mb";
    let accept: readonly string[] | undefined;

    if (options.registry && entityType && fieldName) {
      const entity = options.registry.getEntity(entityType);
      if (entity) {
        const fieldDef = entity.fields[fieldName] as FieldDefinition | undefined;
        if (
          fieldDef &&
          (fieldDef.type === "file" ||
            fieldDef.type === "image" ||
            fieldDef.type === "files" ||
            fieldDef.type === "images")
        ) {
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

    const storageKey = buildStorageKey(
      user.tenantId,
      entityType ?? "unattached",
      entityId ?? 0,
      fieldName ?? "file",
      file.name,
      uuid(),
    );

    const data = new Uint8Array(await file.arrayBuffer());
    await storageProvider.upload(storageKey, data, {
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
    });

    const [row] = await db
      .insert(fileRefsTable)
      .values({
        tenantId: user.tenantId,
        storageKey,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        fieldName: fieldName ?? null,
        insertedById: user.id,
      })
      .returning();

    if (!row) {
      return c.json({ error: "insert_failed" }, 500);
    }

    return c.json(
      {
        id: (row as FileRef).id,
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
    const id = Number(c.req.param("id"));
    const fileRef = await loadFileForTenant(id, user.tenantId);
    if (!fileRef) return c.json({ error: "not_found" }, 404);

    const decision = await guard({ fileRef, user, operation: "read" });
    if (decision === "deny") {
      // 404 rather than 403 so the existence of the file isn't confirmed to
      // an unauthorised caller — matches the tenant-miss response.
      return c.json({ error: "not_found" }, 404);
    }

    const data = await storageProvider.download(fileRef.storageKey);
    return new Response(Buffer.from(data), {
      headers: {
        "Content-Type": fileRef.mimeType,
        "Content-Disposition": `attachment; filename="${fileRef.fileName}"`,
        "Content-Length": String(fileRef.size),
      },
    });
  });

  // DELETE /files/:id — same guard, "delete" operation. Apps can differentiate
  // read vs delete in their custom guard (e.g. only uploaders delete).
  api.delete("/files/:id", async (c) => {
    const user = getUser(c);
    const id = Number(c.req.param("id"));
    const fileRef = await loadFileForTenant(id, user.tenantId);
    if (!fileRef) return c.json({ error: "not_found" }, 404);

    const decision = await guard({ fileRef, user, operation: "delete" });
    if (decision === "deny") return c.json({ error: "not_found" }, 404);

    await storageProvider.delete(fileRef.storageKey);
    await db.delete(fileRefsTable).where(eq(fileRefsTable.id, id));
    return c.json({ ok: true });
  });

  // GET /files/:id/meta — metadata without the bytes. Guarded exactly like
  // download (meta leaks fileName/mimeType/size).
  api.get("/files/:id/meta", async (c) => {
    const user = getUser(c);
    const id = Number(c.req.param("id"));
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

  async function loadFileForTenant(id: number, tenantId: number): Promise<FileRef | null> {
    const [row] = await db
      .select()
      .from(fileRefsTable)
      .where(and(eq(fileRefsTable.id, id), eq(fileRefsTable.tenantId, tenantId)));
    return (row as FileRef | undefined) ?? null;
  }

  return api;
}
