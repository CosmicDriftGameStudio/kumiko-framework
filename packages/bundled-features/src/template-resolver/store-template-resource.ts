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
import { requireForTenant } from "../shared/index.js";
import {
  DEFAULT_RESOURCE_MAX_BYTES,
  parseLinkedResources,
  RESOURCE_MAX_BYTES_CONFIG_KEY,
} from "./handlers/resource-shared.js";
import { executor } from "./handlers/shared.js";
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
      ...parseLinkedResources(row.linkedResources),
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
