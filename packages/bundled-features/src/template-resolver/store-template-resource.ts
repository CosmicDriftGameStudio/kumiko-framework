import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import type {
  BeforeTransactionResult,
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
import {
  type CreateFileRefInput,
  createFileRefFromUploadedBytes,
  type UploadedFileBytes,
  uploadFileBytesBeforeTransaction,
} from "@cosmicdrift/kumiko-framework/files";
import { fileContextForTenant } from "../file-foundation/index.ts";
import { extensionForResourceContentType, requireForTenant } from "../shared/index.ts";
import {
  DEFAULT_RESOURCE_MAX_BYTES,
  MAX_FILE_ATTACHMENTS_PER_TEMPLATE,
  RESOURCE_MAX_BYTES_CONFIG_KEY,
} from "./handlers/resource-shared.ts";
import { executor } from "./handlers/shared.ts";
import {
  attachmentEntriesOf,
  type LinkedResourceEntry,
  parseLinkedResourceEntries,
  templatePdfAttachmentLinkSchema,
} from "./linked-resources.ts";
import { normalizeResourceImage } from "./resource-image.ts";
import { type TemplateResourceRow, templateResourcesTable } from "./table.ts";
import { readTemplateResource } from "./template-resources.ts";
import { ACTIVE_TEMPLATE_STATUS, SYSTEM_TENANT_ID } from "./web/constants.ts";
import { TemplateResolverErrors } from "./web/qualified-names.ts";

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

export type PreparedTemplateImage = {
  readonly kind: "image";
  readonly contentType: string;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly upload: UploadedFileBytes;
};

export type PreparedTemplateAttachment = {
  readonly kind: "attachment";
  readonly contentType: string;
  readonly size: number;
  readonly fileName: string;
  readonly upload: UploadedFileBytes;
};

export type PreparedTemplateFile = PreparedTemplateImage | PreparedTemplateAttachment;

function keyInUse(): WriteResult<never> {
  return writeFailure(
    new UnprocessableError(TemplateResolverErrors.attachmentInvalid, {
      i18nKey: "templateResolver.errors.attachment.invalid",
      details: { code: "key_in_use" },
    }),
  );
}

function isImageKey(links: Readonly<Record<string, LinkedResourceEntry>>, key: string) {
  return typeof links[key] === "string";
}

function isAttachmentKey(links: Readonly<Record<string, LinkedResourceEntry>>, key: string) {
  const occupant = links[key];
  return occupant !== undefined && typeof occupant !== "string";
}

// The upload goes to the target tenant's storage and the release checks that tenant's fileRef rows,
// so both receive the target tenant's db and identity.
function uploadToTenant(
  args: {
    readonly ctx: HandlerContext;
    readonly user: SessionUser;
    readonly tenantId: TenantId;
  },
  input: CreateFileRefInput,
): Promise<BeforeTransactionResult<UploadedFileBytes>> {
  const { ctx, user, tenantId } = args;
  return uploadFileBytesBeforeTransaction(
    {
      db: requireForTenant(ctx, tenantId).db,
      files: fileContextForTenant(ctx, ctx.user.tenantId, tenantId),
      registry: ctx.registry,
      user: { ...user, tenantId },
    },
    input,
  );
}

type TenantScope = {
  readonly ctx: HandlerContext;
  readonly user: SessionUser;
  readonly tenantId: TenantId;
};

function createFileRefFromPrepared(scope: TenantScope, upload: UploadedFileBytes) {
  const { ctx, user, tenantId } = scope;
  return createFileRefFromUploadedBytes(
    { db: requireForTenant(ctx, tenantId).db, user: { ...user, tenantId } },
    upload,
  );
}

async function linkImage(args: {
  readonly ctx: HandlerContext;
  readonly user: SessionUser;
  readonly tenantId: TenantId;
  readonly row: TemplateResourceRow;
  readonly key: string;
  readonly links: Readonly<Record<string, LinkedResourceEntry>>;
  readonly fileRefId: string;
}): Promise<WriteResult<null>> {
  const { ctx, user, tenantId, row, key, links, fileRefId } = args;
  const { db, streamTenantId } = requireForTenant(ctx, tenantId);
  // The replaced FileRef stays: copy-locale and tenant overrides can share ids and
  // there is no reference count to tell when the last user is gone.
  const updated = await executor.update(
    {
      id: row.id,
      version: row.version,
      changes: { linkedResources: JSON.stringify({ ...links, [key]: fileRefId }) },
    },
    user,
    db,
    { streamTenantId },
  );
  return updated.isSuccess ? { isSuccess: true, data: null } : updated;
}

type NormalizedUpload = {
  readonly image: Awaited<ReturnType<typeof normalizeResourceImage>>;
};

async function normalizeUpload(
  bytes: Uint8Array,
  maxBytes: number,
): Promise<{ readonly failure: WriteResult<never> } | NormalizedUpload> {
  if (bytes.length > maxBytes) {
    return {
      failure: writeFailure(
        new UnprocessableError(TemplateResolverErrors.resourceTooLarge, {
          i18nKey: "templateResolver.errors.resource.tooLarge",
          details: { maxBytes, size: bytes.length },
        }),
      ),
    };
  }
  try {
    return { image: await normalizeResourceImage(Buffer.from(bytes)) };
  } catch (cause) {
    return {
      failure: writeFailure(
        new UnprocessableError(TemplateResolverErrors.resourceUnsupportedImage, {
          i18nKey: "templateResolver.errors.resource.unsupportedImage",
          cause: cause instanceof Error ? cause : undefined,
        }),
      ),
    };
  }
}

type ImageTarget = {
  readonly row: TemplateResourceRow | undefined;
  readonly links: Readonly<Record<string, LinkedResourceEntry>>;
};

// Runs before the upload (reject early, store nothing) and again in the transaction on the fresh row.
async function checkImageTarget(args: {
  readonly ctx: HandlerContext;
  readonly tenantId: TenantId;
  readonly templateId?: string | undefined;
  readonly key?: string | undefined;
}): Promise<WriteResult<ImageTarget>> {
  const { ctx, tenantId, templateId, key } = args;
  let row: TemplateResourceRow | undefined;
  if (templateId !== undefined) {
    row = await fetchOne<TemplateResourceRow>(
      requireForTenant(ctx, tenantId).db,
      templateResourcesTable,
      { tenantId, id: templateId },
    );
    if (row === undefined) return writeFailure(new NotFoundError("template-resource", templateId));
  }
  const links = row === undefined ? {} : parseLinkedResourceEntries(row.linkedResources);
  if (key !== undefined && isAttachmentKey(links, key)) return keyInUse();
  return { isSuccess: true, data: { row, links } };
}

// beforeTransaction half: normalizes the image and uploads it to the target tenant's storage.
// The caller is responsible for authorization; the function trusts tenantId.
export async function prepareTemplateResourceBeforeTransaction(args: {
  readonly ctx: HandlerContext;
  readonly user: SessionUser;
  readonly tenantId: TenantId;
  readonly bytes: Uint8Array;
  readonly maxBytes: number;
  readonly templateId?: string;
  readonly key?: string;
}): Promise<BeforeTransactionResult<PreparedTemplateImage>> {
  const { ctx, user, tenantId, bytes, maxBytes, templateId, key } = args;
  const normalized = await normalizeUpload(bytes, maxBytes);
  if ("failure" in normalized) return normalized.failure;
  const { image } = normalized;

  const target = await checkImageTarget({ ctx, tenantId, templateId, key });
  if (!target.isSuccess) return target;

  const uploaded = await uploadToTenant(
    { ctx, user, tenantId },
    {
      // Neutral name: the source's file name may be personal data.
      fileName: `${key ?? "resource"}.${extensionForResourceContentType(image.contentType) ?? "bin"}`,
      mimeType: image.contentType,
      data: image.data,
    },
  );
  if (!uploaded.isSuccess) return uploaded;
  return {
    isSuccess: true,
    data: {
      kind: "image",
      contentType: image.contentType,
      width: image.width,
      height: image.height,
      size: image.data.length,
      upload: uploaded.data,
    },
    ...(uploaded.release && { release: uploaded.release }),
  };
}

export type Release = () => Promise<void>;

// Tries every release, so one failing delete does not strand the other uploads; the first rejection is rethrown.
export async function releaseAll(releases: readonly Release[]): Promise<void> {
  const settled = await Promise.allSettled(releases.map((release) => release()));
  const rejected = settled.find((outcome) => outcome.status === "rejected");
  if (rejected?.status === "rejected") throw rejected.reason;
}

// `upload` is absent for a rendered-PDF link, which carries no file.
export type PreparedLinkedResourceCopy = {
  readonly key: string;
  readonly entry: LinkedResourceEntry;
  readonly upload?: UploadedFileBytes;
};

// beforeTransaction half: copies the file behind every entry into the target tenant's storage, so a
// template copied from the system default keeps working once the tenant exports it or measures its
// attachments. An entry whose source file is gone is left out: it could not be resolved at render
// time either. A failed or throwing upload releases the ones before it.
export async function prepareLinkedResourceCopiesBeforeTransaction(args: {
  readonly ctx: HandlerContext;
  readonly user: SessionUser;
  readonly tenantId: TenantId;
  readonly resources: Readonly<Record<string, LinkedResourceEntry>>;
}): Promise<BeforeTransactionResult<readonly PreparedLinkedResourceCopy[]>> {
  const { ctx, user, tenantId, resources } = args;
  const copies: PreparedLinkedResourceCopy[] = [];
  const releases: Release[] = [];
  try {
    for (const [key, entry] of Object.entries(resources)) {
      if (typeof entry !== "string" && entry.kind === "rendered-pdf") {
        copies.push({ key, entry });
        continue;
      }
      const file = await readTemplateResource(
        ctx,
        typeof entry === "string" ? entry : entry.fileRefId,
      );
      if (file === null) continue;
      const uploaded = await uploadToTenant(
        { ctx, user, tenantId },
        { fileName: file.fileName, mimeType: file.contentType, data: file.bytes },
      );
      if (!uploaded.isSuccess) {
        await releaseAll(releases);
        return uploaded;
      }
      if (uploaded.release) releases.push(uploaded.release);
      copies.push({ key, entry, upload: uploaded.data });
    }
  } catch (cause) {
    await releaseAll(releases);
    throw cause;
  }
  return { isSuccess: true, data: copies, release: () => releaseAll(releases) };
}

// Transaction half: creates the target tenant's fileRef rows and returns the entries pointing at them.
export async function createLinkedResourceCopies(
  scope: TenantScope,
  prepared: readonly PreparedLinkedResourceCopy[],
): Promise<WriteResult<Record<string, LinkedResourceEntry>>> {
  const linked: Record<string, LinkedResourceEntry> = {};
  for (const { key, entry, upload } of prepared) {
    if (typeof entry !== "string" && entry.kind === "rendered-pdf") {
      linked[key] = entry;
      continue;
    }
    // skip: a file entry without a copy must not carry the source tenant's fileRefId over
    if (upload === undefined) continue;
    const created = await createFileRefFromPrepared(scope, upload);
    if (!created.isSuccess) return created;
    linked[key] =
      typeof entry === "string" ? created.data.id : { ...entry, fileRefId: created.data.id };
  }
  return { isSuccess: true, data: linked };
}

// Transaction half: creates the fileRef row for the prepared upload and, with templateId + key,
// links it into the target tenant's template.
export async function storePreparedTemplateResource(args: {
  readonly ctx: HandlerContext;
  readonly user: SessionUser;
  readonly tenantId: TenantId;
  readonly prepared: PreparedTemplateImage;
  readonly templateId?: string;
  readonly key?: string;
}): Promise<WriteResult<StoredTemplateResource>> {
  const { ctx, user, tenantId, prepared, templateId, key } = args;
  const target = await checkImageTarget({ ctx, tenantId, templateId, key });
  if (!target.isSuccess) return target;
  const { row, links } = target.data;

  const created = await createFileRefFromPrepared({ ctx, user, tenantId }, prepared.upload);
  if (!created.isSuccess) return created;

  if (row !== undefined && key !== undefined) {
    const linked = await linkImage({
      ctx,
      user,
      tenantId,
      row,
      key,
      links,
      fileRefId: created.data.id,
    });
    if (!linked.isSuccess) return linked;
  }

  return {
    isSuccess: true as const,
    data: {
      fileRefId: created.data.id,
      ...(key !== undefined && { key }),
      contentType: prepared.contentType,
      width: prepared.width,
      height: prepared.height,
      size: prepared.size,
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

// Files and rendered PDFs share one cap; the entry being replaced under `key` does not count.
export function otherAttachmentCount(
  linked: Readonly<Record<string, LinkedResourceEntry>>,
  key: string,
): number {
  return attachmentEntriesOf(linked).filter(([linkedKey]) => linkedKey !== key).length;
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

type AttachmentTarget = {
  readonly row: TemplateResourceRow;
  readonly linked: Readonly<Record<string, LinkedResourceEntry>>;
};

// Runs before the upload (reject early, store nothing) and again in the transaction on the fresh row.
async function checkAttachmentTarget(args: {
  readonly ctx: HandlerContext;
  readonly tenantId: TenantId;
  readonly templateId: string;
  readonly key: string;
}): Promise<WriteResult<AttachmentTarget>> {
  const { ctx, tenantId, templateId, key } = args;
  const row = await fetchOne<TemplateResourceRow>(
    requireForTenant(ctx, tenantId).db,
    templateResourcesTable,
    { tenantId, id: templateId },
  );
  if (row === undefined) return writeFailure(new NotFoundError("template-resource", templateId));
  if (row.kind !== "mail") return attachmentNeedsMailTemplate();

  const linked = parseLinkedResourceEntries(row.linkedResources);
  if (otherAttachmentCount(linked, key) >= MAX_FILE_ATTACHMENTS_PER_TEMPLATE) {
    return attachmentLimitFailure();
  }
  if (isImageKey(linked, key)) return keyInUse();
  return { isSuccess: true, data: { row, linked } };
}

// beforeTransaction half: validates a PDF/PNG/JPEG and uploads it unchanged to the target tenant's
// storage. With templateId the template is checked first; a bundle import has none yet.
export async function prepareTemplateAttachmentBeforeTransaction(args: {
  readonly ctx: HandlerContext;
  readonly user: SessionUser;
  readonly tenantId: TenantId;
  readonly bytes: Uint8Array;
  readonly maxBytes: number;
  readonly key: string;
  readonly fileName: string;
  readonly templateId?: string;
}): Promise<BeforeTransactionResult<PreparedTemplateAttachment>> {
  const { ctx, user, tenantId, bytes, maxBytes, key, fileName, templateId } = args;
  const inspected = inspectAttachmentBytes(bytes, maxBytes);
  if ("failure" in inspected) return inspected.failure;
  const { type } = inspected;

  if (templateId !== undefined) {
    const target = await checkAttachmentTarget({ ctx, tenantId, templateId, key });
    if (!target.isSuccess) return target;
  }

  const uploaded = await uploadToTenant(
    { ctx, user, tenantId },
    {
      // Neutral stored name: the admin's file name may be personal data and lives in the link entry.
      fileName: `${key}.${type.extension}`,
      mimeType: type.contentType,
      data: bytes,
    },
  );
  if (!uploaded.isSuccess) return uploaded;
  return {
    isSuccess: true,
    data: {
      kind: "attachment",
      contentType: type.contentType,
      size: bytes.length,
      fileName,
      upload: uploaded.data,
    },
    ...(uploaded.release && { release: uploaded.release }),
  };
}

// Creates the fileRef rows for a bundle's prepared uploads; the importer links the entries.
export async function createPreparedBundleResourceEntry(
  scope: TenantScope,
  prepared: PreparedTemplateFile,
): Promise<WriteResult<LinkedResourceEntry>> {
  const created = await createFileRefFromPrepared(scope, prepared.upload);
  if (!created.isSuccess) return created;
  return {
    isSuccess: true,
    data:
      prepared.kind === "image"
        ? created.data.id
        : { kind: "file", fileRefId: created.data.id, fileName: prepared.fileName },
  };
}

// Transaction half: creates the fileRef row for the prepared upload and links it under `key` in a
// mail template of the target tenant.
export async function storePreparedTemplateAttachment(args: {
  readonly ctx: HandlerContext;
  readonly user: SessionUser;
  readonly tenantId: TenantId;
  readonly prepared: PreparedTemplateAttachment;
  readonly templateId: string;
  readonly key: string;
}): Promise<WriteResult<StoredTemplateAttachment>> {
  const { ctx, user, tenantId, prepared, templateId, key } = args;
  const target = await checkAttachmentTarget({ ctx, tenantId, templateId, key });
  if (!target.isSuccess) return target;
  const { row, linked } = target.data;

  const created = await createFileRefFromPrepared({ ctx, user, tenantId }, prepared.upload);
  if (!created.isSuccess) return created;

  const entry: LinkedResourceEntry = {
    kind: "file",
    fileRefId: created.data.id,
    fileName: prepared.fileName,
  };
  const { db, streamTenantId } = requireForTenant(ctx, tenantId);
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
      fileName: prepared.fileName,
      contentType: prepared.contentType,
      size: prepared.size,
    },
  };
}

export type LinkedTemplatePdfAttachment = {
  readonly key: string;
  readonly templateSlug: string;
  readonly fileName: string;
};

function pdfAttachmentInvalid(code: string): WriteResult<never> {
  return writeFailure(
    new UnprocessableError(TemplateResolverErrors.attachmentInvalid, {
      i18nKey: "templateResolver.errors.attachment.invalid",
      details: { code },
    }),
  );
}

// Links a PDF that is rendered from a document template at send time into a mail template of the
// target tenant. Nothing is stored besides the link entry. The caller authorizes tenantId.
export async function linkTemplatePdfAttachment(args: {
  readonly ctx: HandlerContext;
  readonly user: SessionUser;
  readonly tenantId: TenantId;
  readonly templateId: string;
  readonly key: string;
  readonly templateSlug: string;
  readonly fileName: string;
}): Promise<WriteResult<LinkedTemplatePdfAttachment>> {
  const { ctx, user, tenantId, templateId, key } = args;
  const link = templatePdfAttachmentLinkSchema.safeParse({
    kind: "rendered-pdf",
    templateSlug: args.templateSlug,
    fileName: args.fileName,
  });
  if (!link.success) return pdfAttachmentInvalid("invalid_pdf_link");

  const { db, streamTenantId } = requireForTenant(ctx, tenantId);
  const row = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
    tenantId,
    id: templateId,
  });
  if (row === undefined) return writeFailure(new NotFoundError("template-resource", templateId));
  if (row.kind !== "mail") return attachmentNeedsMailTemplate();

  const linked = parseLinkedResourceEntries(row.linkedResources);
  if (isImageKey(linked, key)) return keyInUse();
  if (otherAttachmentCount(linked, key) >= MAX_FILE_ATTACHMENTS_PER_TEMPLATE) {
    return attachmentLimitFailure();
  }

  const visibleTemplates = await selectMany<TemplateResourceRow>(
    db,
    templateResourcesTable,
    {
      tenantId: [tenantId, SYSTEM_TENANT_ID],
      slug: link.data.templateSlug,
      kind: "document-pdf",
      status: ACTIVE_TEMPLATE_STATUS,
    },
    { limit: 1 },
  );
  if (visibleTemplates.length === 0) {
    return writeFailure(
      new UnprocessableError(TemplateResolverErrors.attachmentPdfTemplateMissing, {
        i18nKey: "templateResolver.errors.attachment.pdfTemplateMissing",
        i18nParams: { slug: link.data.templateSlug },
        details: { templateSlug: link.data.templateSlug },
      }),
    );
  }

  const updated = await executor.update(
    {
      id: row.id,
      version: row.version,
      changes: { linkedResources: JSON.stringify({ ...linked, [key]: link.data }) },
    },
    user,
    db,
    { streamTenantId },
  );
  if (!updated.isSuccess) return updated;

  return {
    isSuccess: true as const,
    data: { key, templateSlug: link.data.templateSlug, fileName: link.data.fileName },
  };
}
