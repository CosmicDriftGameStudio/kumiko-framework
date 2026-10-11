import type { TenantDb } from "../db/tenant-db.js";
import type { Registry, SessionUser, WriteResult } from "../engine/types/index.js";
import {
  FrameworkReasons,
  InternalError,
  UnprocessableError,
  writeFailure,
} from "../errors/index.js";
import {
  type CreatedFileRef,
  DEFAULT_MAX_UPLOAD_SIZE,
  storeFileAsFileRef,
} from "./create-file-ref.js";
import type { FileContext } from "./file-handle.js";
import { readFilesRouteOptions } from "./file-routes.js";

export type { CreatedFileRef };

export type CreateFileRefContext = {
  readonly db: TenantDb;
  readonly files?: FileContext | undefined;
  readonly registry: Registry;
  readonly user: SessionUser;
};

export type CreateFileRefInput = {
  readonly fileName: string;
  readonly mimeType: string;
  readonly data: Uint8Array;
  readonly attachTo?: {
    readonly entityType: string;
    readonly fieldName: string;
    readonly entityId?: string;
  };
};

// Server-side counterpart of POST /files for handlers/jobs that produce bytes
// themselves (generated PDFs, exports). Same validation, storage layout and
// fileRef.created event as an upload; the tenant is always ctx.user.tenantId.
export async function createFileRefFromBytes(
  ctx: CreateFileRefContext,
  input: CreateFileRefInput,
): Promise<WriteResult<CreatedFileRef>> {
  const { files } = ctx;
  if (!files) {
    return writeFailure(
      new InternalError({
        message:
          "createFileRefFromBytes: ctx.files is unavailable — mount a file-provider feature to store files",
      }),
    );
  }
  const outcome = await storeFileAsFileRef(
    {
      user: ctx.user,
      tenantDb: ctx.db,
      registry: ctx.registry,
      defaultMaxUploadSize:
        readFilesRouteOptions(ctx.registry).maxUploadSize ?? DEFAULT_MAX_UPLOAD_SIZE,
      writeBytes: (key, data, mimeType) => files.ref(key).write(data, mimeType),
      deleteBytes: (key) => files.ref(key).delete(),
    },
    {
      fileName: input.fileName,
      declaredMimeType: input.mimeType,
      data: input.data,
      entityType: input.attachTo?.entityType,
      entityId: input.attachTo?.entityId,
      fieldName: input.attachTo?.fieldName,
    },
  );
  switch (outcome.kind) {
    case "created":
      return { isSuccess: true, data: outcome.fileRef };
    case "rejected":
      return writeFailure(
        new UnprocessableError(FrameworkReasons.fileRejected, {
          details: { error: outcome.error },
        }),
      );
    case "failed":
      return outcome.failure;
  }
}
