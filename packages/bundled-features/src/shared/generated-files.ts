import { createHash } from "node:crypto";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { HandlerContext, Registry, SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import {
  type CreatedFileRef,
  type CreateFileRefInput,
  createFileRefFromBytes,
} from "@cosmicdrift/kumiko-framework/files";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import {
  type FileRefContent,
  FileRefTooLargeError,
  fileContextForTenant,
  readFileRefContent,
} from "../file-foundation/index.ts";

export const PDF_MIME_TYPE = "application/pdf";
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export type GeneratedFileContext = {
  readonly db: TenantDb;
  readonly services: HandlerContext["services"];
  readonly registry: Registry;
};

type ReadFileContext = Pick<GeneratedFileContext, "db" | "services">;

// The tenant's file refs only: a caller cannot point a request at another tenant's file.
export async function readTenantFile(
  ctx: ReadFileContext,
  tenantId: string,
  fileRefId: string,
): Promise<FileRefContent | null> {
  try {
    return await readFileRefContent({
      db: ctx.db,
      filesForTenant: (ownerTenantId) => fileContextForTenant(ctx, tenantId, ownerTenantId),
      fileRefId,
      allowedTenantIds: [tenantId],
      maxBytes: MAX_DOCUMENT_BYTES,
    });
  } catch (error) {
    if (error instanceof FileRefTooLargeError) return null;
    throw error;
  }
}

export function storeGeneratedFile(
  ctx: GeneratedFileContext,
  user: SessionUser,
  file: {
    readonly fileName: string;
    readonly mimeType: string;
    readonly data: Uint8Array;
    readonly attachTo?: CreateFileRefInput["attachTo"];
  },
): Promise<WriteResult<CreatedFileRef>> {
  return createFileRefFromBytes({ ...ctx, user }, file);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
