import type { RateLimitResolver } from "@cosmicdrift/kumiko-types/rate-limit-types";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { WriteErrorInfo } from "@cosmicdrift/kumiko-types/write-error-info-types";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getUser } from "../api/auth-middleware.ts";
import { requestContext } from "../api/request-context.ts";
import {
  collectPiiSubjectFields,
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
  isPiiCiphertext,
  type KmsContext,
  PII_ERASED_SENTINEL,
} from "../crypto/index.ts";
import type { DbConnection } from "../db/connection.ts";
import { selectMany } from "../db/query.ts";
import {
  runInRowLevelSecurityScope,
  tenantRowLevelSecurityScope,
} from "../db/row-level-security-scope.ts";
import { createProjectingTenantDb, type TenantDb } from "../db/tenant-db.ts";
import {
  createDerivativesContext,
  resolveFieldVariant,
  resolveRenderer,
} from "../derivatives/index.ts";
import { isAnonymousSessionUser, SYSTEM_USER_ID } from "../engine/system-user.ts";
import {
  isFileField,
  isUuid,
  type Registry,
  type SessionUser,
  type TenantId,
} from "../engine/types/index.ts";
import { createFailOpenReporter, respondRateLimited } from "../rate-limit/middleware.ts";
import { listActionFormFileFields, mayUseActionForm } from "./action-form-upload.ts";
import { buildContentDispositionHeader } from "./content-disposition.ts";
import {
  DEFAULT_MAX_UPLOAD_SIZE,
  getFileRefExecutor,
  storeFileAsFileRef,
} from "./create-file-ref.ts";
import { createFileContext, createTenantFileContext } from "./file-handle.ts";
import { fileRefEntity } from "./file-ref-entity.ts";
import { fileRefsTable } from "./file-ref-table.ts";
import type { FileProviderResolver } from "./provider-resolver.ts";
import type { RecordReadCheck } from "./record-read-check.ts";
import {
  isStoredRecordLocked,
  type RecordWriteCheck,
  RecordWriteDecisions,
} from "./record-write-check.ts";
import { neutralFileNameForMimeType } from "./resolve-content-type.ts";
import { parseMaxSize, resolveServedContentType } from "./types.ts";
import { withUploadLedger } from "./upload-ledger.ts";

// Exactly the httpStatus values declared by KumikoError subclasses across packages/*.
const ERROR_STATUSES = [400, 401, 403, 404, 409, 422, 429, 500, 503, 504] as const;

export function deleteFailureResponseFor(error: WriteErrorInfo): {
  readonly status: (typeof ERROR_STATUSES)[number];
  readonly code: string;
} {
  const status = isOneOf(ERROR_STATUSES, error.httpStatus) ? error.httpStatus : 500;
  return { status, code: status === 404 ? "not_found" : error.code };
}

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

// fileRef is a standard ES entity: upload/delete go through the entity
// executor (executor.create/delete below), which emits `fileRef.created` /
// `fileRef.deleted` and materialises file_refs via applyEntityEvent in one
// tx. Downstream MSPs (e.g. storage-tracking) subscribe on those entity
// event types — there is no bespoke files:event:* anymore.

// Checks whether `user` may read/delete the given file. The default guard
// approves uploaders, any role in privilegedRoles and, for reads, everyone who
// may read the record the file is attached to. Apps can supply a custom guard
// to replace that decision entirely.
export type FileAccessGuard = (args: {
  readonly fileRef: FileRef;
  readonly user: SessionUser;
  readonly operation: "read" | "delete";
}) => FileAccessDecision | Promise<FileAccessDecision>;

export type FileRoutesOptions = {
  readonly db: DbConnection;
  // Charges GET /files/meta by id count, because every id costs a KMS-decrypting read.
  // Absent: the route is limited only by the global request limiter.
  readonly metaBatchRateLimitResolver?: RateLimitResolver;
  // Per-tenant provider resolver — resolves through file-foundation so uploads,
  // ctx.services.files and the GDPR jobs all hit the same store. Resolution runs under
  // system identity for the secret-read; request-user authorization is the
  // accessGuard's job below.
  readonly resolveProvider: FileProviderResolver;
  readonly registry?: Registry;
  readonly maxUploadSize?: string; // global default, e.g. "10mb"
  // Roles that bypass the default owner-check on entity-attached files.
  // Defaults to ["Admin", "SystemAdmin"]; override to match your app's roles.
  readonly privilegedRoles?: readonly string[];
  // Roles that may read uploads without a target field (entityType and entityId null, e.g.
  // inbox or dropzone files). Such files belong to no record, so the app decides declaratively
  // who reads them within the tenant. Read only: never delete, and attached files stay behind
  // their record's access. System-generated files (uploaded by the system user) are excluded.
  readonly unclaimedUploadReaders?: readonly string[];
  // Replaces the default guard entirely. When set, privilegedRoles, unclaimedUploadReaders and
  // canReadRecord are ignored — the app takes full responsibility.
  readonly accessGuard?: FileAccessGuard;
  // Lets the default guard grant read on an attached file to everyone who may
  // read its record. buildServer wires it to the entity's detail query.
  readonly canReadRecord?: RecordReadCheck;
  // Gates uploads that name an entityId (attach to a stored record). Absent: such uploads
  // answer 403. A custom accessGuard does not replace it; the guard only covers read/delete
  // of existing files.
  readonly canWriteRecord?: RecordWriteCheck;
};

const DEFAULT_PRIVILEGED_ROLES = ["Admin", "SystemAdmin"] as const;

// 15 minutes — long enough for a download to start, short enough that a
// leaked URL (e.g. from a browser history screenshot) isn't a long-lived
// credential (see "Signed-URL default expiry" in core-files.md).
const SIGNED_URL_DEFAULT_EXPIRY_SECONDS = 15 * 60;

const MAX_BATCH_META_IDS = 100;
const META_BATCH_IDS_PER_WINDOW = 1_000;
const META_BATCH_WINDOW_SECONDS = 60;
// Each detail() read decrypts through the KMS pool; a bounded chunk keeps one batch from hogging it.
const BATCH_META_CONCURRENCY = 10;

type FileMeta = Pick<
  FileRef,
  "id" | "fileName" | "mimeType" | "size" | "entityType" | "entityId" | "fieldName"
>;

// Default guard: on attached files, allow the uploader or a privileged role,
// and for reads also everyone who may read the record. Delete stays with the
// uploader and privileged roles: reading a record is no right to remove its
// files. Pending uploads (entityType set, record not yet created) are the
// uploader's own until bound; so are uploads without an entityType, which no
// record can ever claim.
function createDefaultGuard(
  privilegedRoles: readonly string[],
  canReadRecord: RecordReadCheck | undefined,
  unclaimedUploadReaders: readonly string[],
): FileAccessGuard {
  return async ({ fileRef, user, operation }) => {
    if (fileRef.insertedById === user.id) return "allow";
    if (privilegedRoles.some((role) => user.roles.includes(role))) return "allow";
    // System-generated documents are created without attachTo too, but belong to a person's data, not to an inbox.
    const isUnclaimedUpload =
      fileRef.entityType === null &&
      fileRef.entityId === null &&
      fileRef.insertedById !== SYSTEM_USER_ID;
    if (
      isUnclaimedUpload &&
      operation === "read" &&
      unclaimedUploadReaders.some((role) => user.roles.includes(role))
    ) {
      return "allow";
    }
    if (fileRef.entityType === null || fileRef.entityId === null) return "deny";
    if (operation !== "read" || canReadRecord === undefined) return "deny";
    const recordReadable = await canReadRecord({
      entityType: fileRef.entityType,
      entityId: fileRef.entityId,
      user,
    });
    return recordReadable ? "allow" : "deny";
  };
}

// Multipart framing plus the small entityType/entityId/fieldName parts
// riding alongside the file.
const MULTIPART_OVERHEAD_MARGIN_BYTES = 64 * 1024;

// entityType/fieldName (and therefore the field's own maxSize) are only
// known after the body is parsed, so this covers the largest configured
// field, not just the global default.
export function resolveMaxUploadBodyBytes(
  options: Pick<FileRoutesOptions, "registry" | "maxUploadSize">,
): number {
  let maxBytes = parseMaxSize(options.maxUploadSize ?? DEFAULT_MAX_UPLOAD_SIZE);
  for (const entity of options.registry?.getAllEntities().values() ?? []) {
    for (const field of Object.values(entity.fields)) {
      if (isFileField(field) && field.maxSize) {
        maxBytes = Math.max(maxBytes, parseMaxSize(field.maxSize));
      }
    }
  }
  for (const { fieldDef } of listActionFormFileFields(options.registry)) {
    if (fieldDef.maxSize) maxBytes = Math.max(maxBytes, parseMaxSize(fieldDef.maxSize));
  }
  return maxBytes + MULTIPART_OVERHEAD_MARGIN_BYTES;
}

// Upload-route policy carried by createFilesFeature(opts?) — read from the
// feature's exports so callers apply it without a parallel options surface.
export function readFilesRouteOptions(
  registry: Registry,
): Pick<
  FileRoutesOptions,
  "accessGuard" | "privilegedRoles" | "unclaimedUploadReaders" | "maxUploadSize"
> {
  const exp = registry.features.get("files")?.exports;
  if (exp && typeof exp === "object" && "routeOptions" in exp) {
    const ro = exp.routeOptions;
    if (ro && typeof ro === "object") {
      // @cast-boundary feature-exports — typeof-checked read-back from untyped feature.exports
      return ro as Pick<
        FileRoutesOptions,
        "accessGuard" | "privilegedRoles" | "unclaimedUploadReaders" | "maxUploadSize"
      >;
    }
  }
  return {};
}

export function createFileRoutes(options: FileRoutesOptions): Hono {
  const { db, metaBatchRateLimitResolver } = options;
  const reportMetaBatchLimiterFailOpen = createFailOpenReporter("files-meta-batch");
  // Plain resolvers (not built via withFileProviderResolver) get the ledger on the route's own root connection.
  const resolveProvider: FileProviderResolver = options.resolveProvider.uploadLedgerFor
    ? options.resolveProvider
    : withUploadLedger(options.resolveProvider, db);
  const privilegedRoles = options.privilegedRoles ?? DEFAULT_PRIVILEGED_ROLES;
  const guard: FileAccessGuard =
    options.accessGuard ??
    createDefaultGuard(
      privilegedRoles,
      options.canReadRecord,
      options.unclaimedUploadReaders ?? [],
    );
  const executor = getFileRefExecutor();
  const piiSubjectFields = collectPiiSubjectFields(fileRefEntity);
  const api = new Hono();
  // These routes read the file table on the root connection, outside the dispatcher, so the caller's tenant scope is opened here.
  api.use("*", async (c, next) => {
    const user: SessionUser | undefined = getUser(c);
    if (user === undefined) return next();
    return runInRowLevelSecurityScope(tenantRowLevelSecurityScope(user.tenantId), next);
  });
  const tenantDbFor = (tenantId: TenantId): TenantDb =>
    createProjectingTenantDb(db, tenantId, options.registry);

  const fileNameIsPersonal = piiSubjectFields.includes("fileName");

  function kmsContextFor(): KmsContext {
    return { requestId: requestContext.get()?.requestId ?? "file-routes" };
  }

  // loadFileForTenant is a raw selectMany — unlike executor.detail() (used by
  // /meta), it never decrypts. Decrypting via detail() here would add its
  // getStreamVersion/entity-cache overhead to these binary-serving hot
  // paths, so this calls the same PII cipher directly on the already-
  // fetched row: one KMS key fetch instead of detail()'s full read path.
  async function resolveFileName(fileRef: FileRef): Promise<string> {
    if (!isPiiCiphertext(fileRef.fileName)) return fileRef.fileName;
    const kms = configuredPiiSubjectKms();
    // skip: the framework has no logger at this route layer and the file bytes are
    // still served; the "download" fallback only hides the stored ciphertext name.
    if (!kms) {
      return "download";
    }
    try {
      const decrypted = await decryptPiiFieldValues(
        { fileName: fileRef.fileName },
        piiSubjectFields,
        kms,
        kmsContextFor(),
      );
      const name = decrypted["fileName"];
      // decryptPiiFieldValues returns the row untouched when fileName isn't
      // annotated as PII (annotation drift), so ciphertext/erased sentinel
      // can still be here and must never reach a header.
      if (typeof name !== "string" || isPiiCiphertext(name) || name === PII_ERASED_SENTINEL) {
        return "download";
      }
      return name;
    } catch {
      // skip: broken crypto metadata (malformed ciphertext, auth failure, missing key)
      // must not make intact bytes unreachable; the route layer has no logger.
      return "download";
    }
  }

  // Runs before parseBody buffers the request below: checks Content-Length
  // upfront, counts chunked bodies while streaming.
  const uploadBodyLimit = bodyLimit({
    maxSize: resolveMaxUploadBodyBytes(options),
    onError: (c) =>
      c.json(
        { error: "request_too_large: request body exceeds the maximum allowed upload size" },
        413,
      ),
  });

  // POST /files — multipart upload.
  api.post("/files", uploadBodyLimit, async (c) => {
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
    const actionForm = typeof body["actionForm"] === "string" ? body["actionForm"] : undefined;

    // Ahead of the record check below, which would answer 404/403 for the entity half.
    if (actionForm !== undefined && (entityType !== undefined || entityId !== undefined)) {
      return c.json(
        { error: "invalid_action_form: actionForm cannot be combined with entityType or entityId" },
        400,
      );
    }

    // Before any bytes are written, like the record check below. An unresolvable screen falls
    // through to storeFileAsFileRef, which answers 400; a known one must be submittable by the
    // caller. Anonymous callers cannot bind pending uploads, so they get no upload either.
    if (
      actionForm !== undefined &&
      options.registry !== undefined &&
      options.registry.getScreen(actionForm)?.type === "actionForm" &&
      (isAnonymousSessionUser(user) || !mayUseActionForm(options.registry, actionForm, user))
    ) {
      return c.json({ error: "forbidden: no access to this form" }, 403);
    }

    if (entityId !== undefined) {
      if (entityType === undefined) {
        return c.json({ error: "missing_entity_type: entityId requires entityType" }, 400);
      }
      // Before any bytes are written: a rejected attach must leave no file behind. An
      // unregistered entityType attaches to nothing; storeFileAsFileRef rejects it with 400.
      const decision =
        options.registry !== undefined && options.registry.getEntity(entityType) === undefined
          ? RecordWriteDecisions.writable
          : options.canWriteRecord
            ? await options.canWriteRecord({ entityType, entityId, fieldName, user })
            : RecordWriteDecisions.forbidden;
      switch (decision) {
        case RecordWriteDecisions.writable:
          break;
        case RecordWriteDecisions.notFound:
          return c.json({ error: "not_found" }, 404);
        case RecordWriteDecisions.forbidden:
          return c.json({ error: "forbidden: no write access to this record" }, 403);
        case RecordWriteDecisions.locked:
          return c.json({ error: "record_locked: the record is locked" }, 409);
      }
    }

    const data = new Uint8Array(await file.arrayBuffer());
    const files = createTenantFileContext(resolveProvider, user.tenantId);
    const { registry } = options;
    const isAttachTargetLocked =
      registry !== undefined && entityType !== undefined && entityId !== undefined
        ? (rowDb: TenantDb) => isStoredRecordLocked({ registry, db: rowDb, entityType, entityId })
        : undefined;
    const outcome = await storeFileAsFileRef(
      {
        user,
        tenantDb: tenantDbFor(user.tenantId),
        rowInOwnTransaction: true,
        registry: options.registry,
        defaultMaxUploadSize: options.maxUploadSize ?? DEFAULT_MAX_UPLOAD_SIZE,
        writeBytes: (key, bytes, mimeType) => files.writeUploadBytes(key, bytes, mimeType),
        deleteBytes: async (key) => {
          await files.ref(key).delete();
          await files.forgetUploadBytes(key);
        },
        ...(isAttachTargetLocked ? { isAttachTargetLocked } : {}),
      },
      {
        fileName: file.name,
        declaredMimeType: file.type,
        data,
        entityType,
        entityId,
        fieldName,
        actionForm,
      },
    );
    if (outcome.kind === "rejected") return c.json({ error: outcome.error }, 400);
    if (outcome.kind === "target-locked") {
      return c.json({ error: "record_locked: the record is locked" }, 409);
    }
    if (outcome.kind === "failed") return c.json({ error: "upload_failed" }, 500);
    return c.json(outcome.fileRef, 201);
  });

  // GET /files/meta?ids=a,b,c — meta of many files in one request (list/card
  // cells otherwise fire one request per row). Unreadable and unknown ids are
  // left out of the answer, same as /files/:id/meta answering 404 for them.
  // Registered before /files/:id so "meta" is never taken for an id.
  api.get("/files/meta", async (c) => {
    const user = getUser(c);
    const ids = [...new Set((c.req.query("ids") ?? "").split(",").filter((id) => isUuid(id)))];
    if (ids.length > MAX_BATCH_META_IDS) return c.json({ error: "too_many_ids" }, 400);
    if (metaBatchRateLimitResolver && ids.length > 0) {
      const bucket = `files-meta:${user.tenantId}:${user.id}`;
      try {
        const decision = await metaBatchRateLimitResolver.check(bucket, {
          limit: META_BATCH_IDS_PER_WINDOW,
          windowSeconds: META_BATCH_WINDOW_SECONDS,
          cost: ids.length,
        });
        if (!decision.allowed) return respondRateLimited(c, decision, bucket);
      } catch (e) {
        reportMetaBatchLimiterFailOpen(e);
      }
    }
    const files: FileMeta[] = [];
    for (let start = 0; start < ids.length; start += BATCH_META_CONCURRENCY) {
      const chunk = ids.slice(start, start + BATCH_META_CONCURRENCY);
      const metas = await Promise.all(chunk.map((id) => loadReadableFileMeta(id, user)));
      for (const meta of metas) if (meta) files.push(meta);
    }
    return c.json({ files });
  });

  // GET /files/:id — download.
  //
  // Authorization stack:
  //   1. tenantId must match (hard isolation, never crossable).
  //   2. The configured FileAccessGuard decides read access. Default:
  //      unattached → allow; attached → uploader, privileged role or a
  //      reader of the record.
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

    const storageProvider = await options.resolveProvider(user.tenantId);
    const data = await storageProvider.read(fileRef.storageKey);
    // The stored mimeType is client-declared (file.type off the upload) and
    // never verified against the bytes — serving it as-is would let a
    // client label real HTML/SVG as e.g. image/png to slip active content
    // out under a trusted-looking Content-Type. Sniff the actual bytes
    // instead; anything that isn't a known-safe binary signature (including
    // svg/html, which have none) goes out as application/octet-stream.
    const contentType = resolveServedContentType(data, fileRef.mimeType);
    return new Response(Buffer.from(data), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": buildContentDispositionHeader(await resolveFileName(fileRef)),
        "Content-Length": String(fileRef.size),
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  // GET /files/:id/variant/:name — a named derived version of the file.
  // Same tenant + guard gate as the download above; the original stays
  // reachable only through that route. The public, anonymous counterpart is
  // a separate cut and does not go through createFileRoutes.
  api.get("/files/:id/variant/:name", async (c) => {
    const user = getUser(c);
    const id = c.req.param("id");
    const name = c.req.param("name");
    const fileRef = await loadFileForTenant(id, user.tenantId);
    if (!fileRef) return c.json({ error: "not_found" }, 404);

    const decision = await guard({ fileRef, user, operation: "read" });
    if (decision === "deny") return c.json({ error: "not_found" }, 404);

    // An unknown name and a denied file answer alike, so the route never
    // confirms what exists.
    const registry = options.registry;
    const spec = registry
      ? resolveFieldVariant(registry, fileRef.entityType, fileRef.fieldName, name)
      : undefined;
    if (!registry || !spec) return c.json({ error: "not_found" }, 404);

    // The file's mimeType comes from the upload (`file.type`) — validateFile
    // only checks it against the field's `accept` when the field declares
    // one, so a field without `accept` lets a client upload anything and
    // then request /variant/*. Without this check, derivatives.variant()
    // throws for an unsupported source mimeType — an uncaught 500 whose
    // message lists every registered renderer's extension name.
    if (!resolveRenderer(registry, fileRef.mimeType)) {
      return c.json({ error: "unsupported_media_type" }, 415);
    }

    // Built per request: createFileContext caches the resolved provider, so
    // one shared across requests would serve tenant A's store to tenant B.
    const files = createFileContext(() => options.resolveProvider(user.tenantId), user.tenantId);
    const derivatives = createDerivativesContext({
      files,
      registry,
      db,
      tenantId: user.tenantId,
    });
    const result = await derivatives.variant(id, spec, name);
    const data = await files.refFromFileRef(result).read();
    // No Content-Length/Content-Disposition: fileRef.size is the ORIGINAL's
    // size, and a variant is rendered for display, not for download.
    // storageKey embeds specHash(spec), so the URL is content-stable until
    // the spec changes — safe to cache. "private" because the response sits
    // behind the tenant + guard gate above, not a shared CDN-cacheable asset.
    return new Response(Buffer.from(data), {
      headers: {
        "Content-Type": result.mimeType,
        "Cache-Control": "private, max-age=31536000, immutable",
        // Explicit here, not left to the app-wide security-headers default, so the route stays safe standalone.
        "X-Content-Type-Options": "nosniff",
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

    // Delete via the standard entity executor: emits fileRef.deleted and
    // applies it in one tx. fileRef is softDelete → the row is flagged
    // isDeleted=true (reads filter it out) and stays recoverable; the binary
    // is intentionally KEPT so a restore can bring the file back. Hard
    // erasure of row + binary is the job of the forget-flow (Art. 17) and the
    // generic data-retention cleanup — same lifecycle as any soft-delete
    // entity, not a files-specific path.
    const result = await executor.delete({ id }, user, tenantDbFor(user.tenantId));
    if (!result.isSuccess) {
      // NotFound (race between guard and executor) reuses the 404-masking
      // pattern from the access-deny path above. Everything else (version
      // conflict 409, ownership 403, validation 422, internal 500) gets the
      // real status off the error so callers can distinguish recoverable
      // from terminal — a blanket 404 here had obscured exactly that.
      const { status, code } = deleteFailureResponseFor(result.error);
      return c.json({ error: code }, status);
    }
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
    const user = getUser(c);
    const id = c.req.param("id");
    const fileRef = await loadFileForTenant(id, user.tenantId);
    if (!fileRef) return c.json({ error: "not_found" }, 404);

    const decision = await guard({ fileRef, user, operation: "read" });
    if (decision === "deny") return c.json({ error: "not_found" }, 404);

    // Resolve after access-check: tenant-scoped provider, and capability
    // disclosure (501) stays behind the auth+guard gate.
    const storageProvider = await options.resolveProvider(user.tenantId);
    if (!storageProvider.getSignedUrl) {
      return c.json(
        {
          error:
            "signed_urls_not_supported: this provider does not support signed URLs — use GET /files/:id to stream",
        },
        501,
      );
    }

    const expiresInSeconds = SIGNED_URL_DEFAULT_EXPIRY_SECONDS;
    const url = await storageProvider.getSignedUrl(fileRef.storageKey, expiresInSeconds, {
      // Hint the provider to set Content-Disposition so the browser prompts
      // with a readable filename instead of the UUID-based storage key.
      // Sanitised via buildContentDispositionHeader — the same attacker-
      // controlled fileName reaches the provider's presigned response.
      // A personal fileName never goes into the URL: the signed query string
      // lands in storage access logs and proxies and outlives a crypto-shred.
      // The streaming route keeps the real name in a response header only.
      contentDisposition: buildContentDispositionHeader(
        fileNameIsPersonal
          ? neutralFileNameForMimeType(fileRef.mimeType)
          : await resolveFileName(fileRef),
      ),
    });
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    return c.json({ url, expiresAt });
  });

  // Metadata without the bytes. Unlike the byte-serving routes, this returns
  // fileName as JSON — and fileName is `personal: "self"`, so it must
  // go through the entity executor's detail() to decrypt instead of
  // loadFileForTenant's raw, still-encrypted read.
  async function loadReadableFileMeta(id: string, user: SessionUser): Promise<FileMeta | null> {
    // Same 22P02-avoidance as loadFileForTenant — detail() doesn't validate
    // id shape before it hits the UUID column.
    if (!isUuid(id)) return null;
    const row = await executor.detail({ id }, user, tenantDbFor(user.tenantId));
    if (!row) return null;
    const fileRef = row as FileRef; // @cast-boundary db-row (decrypted via executor.detail)
    // detail()'s "pass"-ownership read widens to tenantId IN (self, SYSTEM),
    // narrower in loadFileForTenant's selectMany. Restore that here so meta
    // doesn't leak reference-tenant rows.
    if (fileRef.tenantId !== user.tenantId) return null;

    const decision = await guard({ fileRef, user, operation: "read" });
    if (decision === "deny") return null;

    return {
      id: fileRef.id,
      fileName: fileRef.fileName,
      mimeType: fileRef.mimeType,
      size: fileRef.size,
      entityType: fileRef.entityType,
      entityId: fileRef.entityId,
      fieldName: fileRef.fieldName,
    };
  }

  api.get("/files/:id/meta", async (c) => {
    const meta = await loadReadableFileMeta(c.req.param("id"), getUser(c));
    return meta ? c.json(meta) : c.json({ error: "not_found" }, 404);
  });

  async function loadFileForTenant(id: string, tenantId: TenantId): Promise<FileRef | null> {
    // fileRefsTable.id is a UUID column — a malformed id must fail here, not
    // at Postgres (22P02 poisons the pooled connection). 404, not
    // 400: an authenticated caller sending a bad id must see the same
    // response as a nonexistent one, no existence-oracle.
    if (!isUuid(id)) return null;
    // isDeleted:false — soft-deleted (trashed) rows stay recoverable but must
    // never surface to reads/guards.
    const [row] = await selectMany(db, fileRefsTable, { id, tenantId, isDeleted: false });
    return (row as FileRef | undefined) ?? null; // @cast-boundary db-row
  }

  return api;
}
