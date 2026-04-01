import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import { getUser } from "../api/auth-middleware";
import type { DbConnection } from "../db/connection";
import type { FieldDefinition, Registry } from "../engine/types";
import { fileRefsTable } from "./file-ref-table";
import type { FileStorageProvider } from "./types";
import { buildStorageKey, validateFile } from "./types";

export type FileRoutesOptions = {
  db: DbConnection;
  storageProvider: FileStorageProvider;
  registry?: Registry;
  maxUploadSize?: string; // global default, e.g. "10mb"
};

type FileRef = {
  id: number;
  tenantId: number;
  storageKey: string;
  fileName: string;
  mimeType: string;
  size: number;
  entityType: string | null;
  entityId: number | null;
  fieldName: string | null;
};

export function createFileRoutes(options: FileRoutesOptions): Hono {
  const { db, storageProvider } = options;
  const api = new Hono();

  // POST /files — multipart upload
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

    // Validate against entity field definition if available
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

    // Build storage key
    const storageKey = buildStorageKey(
      user.tenantId,
      entityType ?? "unattached",
      entityId ?? 0,
      fieldName ?? "file",
      file.name,
      uuid(),
    );

    // Upload to storage
    const data = new Uint8Array(await file.arrayBuffer());
    await storageProvider.upload(storageKey, data, {
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
    });

    // Save FileRef to DB
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

  // GET /files/:id — download
  api.get("/files/:id", async (c) => {
    const user = getUser(c);
    const id = Number(c.req.param("id"));

    const [row] = await db
      .select()
      .from(fileRefsTable)
      .where(and(eq(fileRefsTable.id, id), eq(fileRefsTable.tenantId, user.tenantId)));

    if (!row) {
      return c.json({ error: "not_found" }, 404);
    }

    const fileRef = row as FileRef;
    const data = await storageProvider.download(fileRef.storageKey);

    return new Response(Buffer.from(data), {
      headers: {
        "Content-Type": fileRef.mimeType,
        "Content-Disposition": `attachment; filename="${fileRef.fileName}"`,
        "Content-Length": String(fileRef.size),
      },
    });
  });

  // DELETE /files/:id
  api.delete("/files/:id", async (c) => {
    const user = getUser(c);
    const id = Number(c.req.param("id"));

    const [row] = await db
      .select()
      .from(fileRefsTable)
      .where(and(eq(fileRefsTable.id, id), eq(fileRefsTable.tenantId, user.tenantId)));

    if (!row) {
      return c.json({ error: "not_found" }, 404);
    }

    const fileRef = row as FileRef;

    // Delete from storage
    await storageProvider.delete(fileRef.storageKey);

    // Delete from DB
    await db.delete(fileRefsTable).where(eq(fileRefsTable.id, id));

    return c.json({ ok: true });
  });

  // GET /files/:id/meta — file metadata without download
  api.get("/files/:id/meta", async (c) => {
    const user = getUser(c);
    const id = Number(c.req.param("id"));

    const [row] = await db
      .select()
      .from(fileRefsTable)
      .where(and(eq(fileRefsTable.id, id), eq(fileRefsTable.tenantId, user.tenantId)));

    if (!row) {
      return c.json({ error: "not_found" }, 404);
    }

    const fileRef = row as FileRef;
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

  return api;
}
