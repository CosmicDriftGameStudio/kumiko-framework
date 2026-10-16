import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type {
  ConfigAccessor,
  HandlerContext,
  Registry,
  SessionUser,
  TenantId,
  WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  NotFoundError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { createFileRefFromBytes } from "@cosmicdrift/kumiko-framework/files";
import { fileContextForTenant } from "../file-foundation/index.js";
import type { FileAttachmentRef } from "../renderer-foundation/index.js";
import { requireForTenant } from "../shared/index.js";
import {
  DEFAULT_RESOURCE_MAX_BYTES,
  MAX_FILE_ATTACHMENTS_PER_TEMPLATE,
  RESOURCE_MAX_BYTES_CONFIG_KEY,
} from "./handlers/resource-shared.js";
import { executor } from "./handlers/shared.js";
import {
  isFileAttachmentEntry,
  type LinkedResourceEntry,
  parseLinkedResourceEntries,
} from "./linked-resources.js";
import { TemplateResolverErrors } from "./qualified-names.js";
import { normalizeResourceImage } from "./resource-image.js";
import { type TemplateResourceRow, templateResourcesTable } from "./table.js";

const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export async function readTemplateResourceMaxBytes(
  config: ConfigAccessor | undefined,
  registry: Registry,
): Promise<number> {
  if (config === undefined || registry.getConfigKey(RESOURCE_MAX_BYTES_CONFIG_KEY) === undefined) {
    return DEFAULT_RESOURCE_MAX_BYTES;
  }
  const value = await config(RESOURCE_MAX_BYTES_CONFIG_KEY);
  return typeof value === "number" ? value : DEFAULT_RESOURCE_MAX_BYTES;
}

export type StoredTemplateResource = {
  readonly fileRefId: string;
  readonly key?: string;
  readonly contentType: string;
  readonly width: number;
  readonly height: number;
  readonly size: number;
};

// Normalizes the image, stores it as a file ref of the target tenant and, with templateId + key,
// links it into that tenant's template. The caller is responsible for authorization; the function trusts tenantId.
export async function storeTemplateResource(args: {
  readonly ctx: HandlerContext;
  readonly user: SessionUser;
  readonly tenantId: TenantId;
  readonly bytes: Uint8Array;
  readonly maxBytes: number;
  readonly templateId?: string;
  readonly key?: string;
}): Promise<WriteResult<StoredTemplateResource>> {
  const { ctx, user, tenantId, bytes, maxBytes, templateId, key } = args;
  if (bytes.length > maxBytes) {
    return writeFailure(
      new UnprocessableError(TemplateResolverErrors.resourceTooLarge, {
        details: { maxBytes, size: bytes.length },
      }),
    );
  }
  let image: Awaited<ReturnType<typeof normalizeResourceImage>>;
  try {
    image = await normalizeResourceImage(Buffer.from(bytes));
  } catch (cause) {
    return writeFailure(
      new UnprocessableError(TemplateResolverErrors.resourceUnsupportedImage, {
        cause: cause instanceof Error ? cause : undefined,
      }),
    );
  }

  const { db, streamTenantId } = requireForTenant(ctx, tenantId);
  let row: TemplateResourceRow | undefined;
  if (templateId !== undefined) {
    row = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
      tenantId,
      id: templateId,
    });
    if (row === undefined) return writeFailure(new NotFoundError("template-resource", templateId));
  }

  const created = await createFileRefFromBytes(
    {
      db,
      files: fileContextForTenant(ctx, tenantId),
      registry: ctx.registry,
      user: { ...user, tenantId },
    },
    {
      // Neutral name: the source's file name may be personal data.
      fileName: `${key ?? "resource"}.${EXTENSION_BY_CONTENT_TYPE[image.contentType] ?? "bin"}`,
      mimeType: image.contentType,
      data: image.data,
    },
  );
  if (!created.isSuccess) return created;

  if (row !== undefined && key !== undefined) {
    // The replaced FileRef stays: copy-locale and tenant overrides can share ids and
    // there is no reference count to tell when the last user is gone.
    const linkedResources = {
      ...parseLinkedResourceEntries(row.linkedResources),
      [key]: created.data.id,
    };
    const updated = await executor.update(
      {
        id: row.id,
        version: row.version,
        changes: { linkedResources: JSON.stringify(linkedResources) },
      },
      user,
      db,
      { streamTenantId },
    );
    if (!updated.isSuccess) return updated;
  }

  return {
    isSuccess: true as const,
    data: {
      fileRefId: created.data.id,
      ...(key !== undefined && { key }),
      contentType: image.contentType,
      width: image.width,
      height: image.height,
      size: image.data.length,
    },
  };
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;

const ATTACHMENT_TYPES = [
  { contentType: "application/pdf", extension: "pdf", magic: PDF_MAGIC },
  { contentType: "image/png", extension: "png", magic: PNG_MAGIC },
  { contentType: "image/jpeg", extension: "jpg", magic: JPEG_MAGIC },
] as const;

function detectAttachmentType(bytes: Uint8Array) {
  return ATTACHMENT_TYPES.find(({ magic }) => magic.every((byte, index) => bytes[index] === byte));
}

export type StoredTemplateAttachment = {
  readonly fileRefId: string;
  readonly key: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
};

type AttachmentType = NonNullable<ReturnType<typeof detectAttachmentType>>;

export function attachmentNeedsMailTemplate(): WriteResult<never> {
  return writeFailure(
    new UnprocessableError(TemplateResolverErrors.attachmentInvalid, {
      i18nKey: "templateResolver.errors.attachment.invalid",
      details: { code: "mail_only" },
    }),
  );
}

export function attachmentLimitFailure(): WriteResult<never> {
  return writeFailure(
    new UnprocessableError(TemplateResolverErrors.attachmentLimit, {
      i18nKey: "templateResolver.errors.attachment.limit",
      i18nParams: { max: MAX_FILE_ATTACHMENTS_PER_TEMPLATE },
      details: { max: MAX_FILE_ATTACHMENTS_PER_TEMPLATE },
    }),
  );
}

function inspectAttachmentBytes(
  bytes: Uint8Array,
  maxBytes: number,
): { readonly failure: WriteResult<never> } | { readonly type: AttachmentType } {
  if (bytes.length > maxBytes) {
    return {
      failure: writeFailure(
        new UnprocessableError(TemplateResolverErrors.resourceTooLarge, {
          details: { maxBytes, size: bytes.length },
        }),
      ),
    };
  }
  const type = detectAttachmentType(bytes);
  if (type === undefined) {
    return {
      failure: writeFailure(
        new UnprocessableError(TemplateResolverErrors.attachmentUnsupportedType, {
          i18nKey: "templateResolver.errors.attachment.unsupportedType",
        }),
      ),
    };
  }
  return { type };
}

// Stores the bytes unchanged as a file of the target tenant, without linking it anywhere.
async function createAttachmentFileRef(args: {
  readonly ctx: HandlerContext;
  readonly user: SessionUser;
  readonly tenantId: TenantId;
  readonly bytes: Uint8Array;
  readonly key: string;
  readonly type: AttachmentType;
}): Promise<WriteResult<{ readonly id: string }>> {
  const { ctx, user, tenantId, bytes, key, type } = args;
  const { db } = requireForTenant(ctx, tenantId);
  const created = await createFileRefFromBytes(
    {
      db,
      files: fileContextForTenant(ctx, tenantId),
      registry: ctx.registry,
      user: { ...user, tenantId },
    },
    {
      // Neutral stored name: the admin's file name may be personal data and lives in the link entry.
      fileName: `${key}.${type.extension}`,
      mimeType: type.contentType,
      data: bytes,
    },
  );
  return created.isSuccess ? { isSuccess: true, data: { id: created.data.id } } : created;
}

// Stores a PDF/PNG/JPEG for a bundle import: validated like an upload, linked later by the importer.
export async function storeBundleAttachment(args: {
  readonly ctx: HandlerContext;
  readonly user: SessionUser;
  readonly tenantId: TenantId;
  readonly bytes: Uint8Array;
  readonly maxBytes: number;
  readonly key: string;
  readonly fileName: string;
}): Promise<WriteResult<FileAttachmentRef>> {
  const inspected = inspectAttachmentBytes(args.bytes, args.maxBytes);
  if ("failure" in inspected) return inspected.failure;
  const created = await createAttachmentFileRef({ ...args, type: inspected.type });
  if (!created.isSuccess) return created;
  return {
    isSuccess: true,
    data: { kind: "file", fileRefId: created.data.id, fileName: args.fileName },
  };
}

// Stores a PDF/PNG/JPEG byte-for-byte (no re-encoding, the recipient gets what the admin uploaded)
// and links it under `key` in a mail template of the target tenant. The caller authorizes tenantId.
export async function storeTemplateAttachment(args: {
  readonly ctx: HandlerContext;
  readonly user: SessionUser;
  readonly tenantId: TenantId;
  readonly bytes: Uint8Array;
  readonly maxBytes: number;
  readonly templateId: string;
  readonly key: string;
  readonly fileName: string;
}): Promise<WriteResult<StoredTemplateAttachment>> {
  const { ctx, user, tenantId, bytes, maxBytes, templateId, key, fileName } = args;
  const inspected = inspectAttachmentBytes(bytes, maxBytes);
  if ("failure" in inspected) return inspected.failure;
  const { type } = inspected;

  const { db, streamTenantId } = requireForTenant(ctx, tenantId);
  const row = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
    tenantId,
    id: templateId,
  });
  if (row === undefined) return writeFailure(new NotFoundError("template-resource", templateId));
  if (row.kind !== "mail") return attachmentNeedsMailTemplate();

  const linked = parseLinkedResourceEntries(row.linkedResources);
  const otherFileCount = Object.entries(linked).filter(
    ([linkedKey, entry]) => linkedKey !== key && isFileAttachmentEntry(entry),
  ).length;
  if (otherFileCount >= MAX_FILE_ATTACHMENTS_PER_TEMPLATE) return attachmentLimitFailure();

  const created = await createAttachmentFileRef({ ctx, user, tenantId, bytes, key, type });
  if (!created.isSuccess) return created;

  const entry: LinkedResourceEntry = { kind: "file", fileRefId: created.data.id, fileName };
  const updated = await executor.update(
    {
      id: row.id,
      version: row.version,
      changes: { linkedResources: JSON.stringify({ ...linked, [key]: entry }) },
    },
    user,
    db,
    { streamTenantId },
  );
  if (!updated.isSuccess) return updated;

  return {
    isSuccess: true as const,
    data: {
      fileRefId: created.data.id,
      key,
      fileName,
      contentType: type.contentType,
      size: bytes.length,
    },
  };
}
