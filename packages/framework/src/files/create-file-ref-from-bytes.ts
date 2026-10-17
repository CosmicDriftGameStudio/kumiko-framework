import { fetchOne } from "../db/query.js";
import type { TenantDb } from "../db/tenant-db.js";
import type {
  BeforeTransactionResult,
  Registry,
  SessionUser,
  WriteResult,
} from "../engine/types/index.js";
import {
  FrameworkReasons,
  InternalError,
  UnprocessableError,
  writeFailure,
} from "../errors/index.js";
import {
  type CreatedFileRef,
  createFileRefRow,
  DEFAULT_MAX_UPLOAD_SIZE,
  storeFileAsFileRef,
  type UploadedFileBytes,
  writeAcceptedFileBytes,
} from "./create-file-ref.js";
import type { FileContext } from "./file-handle.js";
import { fileRefsTable } from "./file-ref-table.js";
import { readFilesRouteOptions } from "./file-routes.js";
import { assertSafeStorageKey } from "./types.js";

export type { CreatedFileRef, UploadedFileBytes };

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

// The handler context has no HTTP/job/seed marker to name, so the message states the actual
// cause: the dispatcher's AppContext carries no file-provider resolver.
export function filesUnavailableMessage(caller: string): string {
  return `${caller}: ctx.files is unavailable because no file-provider resolver is wired on this dispatcher context. Mount a file-provider-* feature and build the dispatcher context with withFileProviderResolver (HTTP, job and seed dispatchers each need it)`;
}

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
        message: filesUnavailableMessage("createFileRefFromBytes"),
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
      return fileRejectedFailure(outcome.error);
    case "failed":
      return outcome.failure;
  }
}

export type UploadFileBytesContext = Pick<
  CreateFileRefContext,
  "db" | "files" | "registry" | "user"
>;

function fileRejectedFailure(error: string) {
  return writeFailure(
    new UnprocessableError(FrameworkReasons.fileRejected, { details: { error } }),
  );
}

// Pre-transaction half of createFileRefFromBytes: validates and writes the binary while no
// transaction holds a connection. Pair it with createFileRefFromUploadedBytes inside the handler.
// A crash between this phase and the commit leaves the bytes in storage; nothing sweeps them.
export async function uploadFileBytesBeforeTransaction(
  ctx: UploadFileBytesContext,
  input: CreateFileRefInput,
): Promise<BeforeTransactionResult<UploadedFileBytes>> {
  const { files } = ctx;
  if (!files) {
    return writeFailure(
      new InternalError({
        message: filesUnavailableMessage("uploadFileBytesBeforeTransaction"),
      }),
    );
  }
  const outcome = await writeAcceptedFileBytes(
    {
      user: ctx.user,
      registry: ctx.registry,
      defaultMaxUploadSize:
        readFilesRouteOptions(ctx.registry).maxUploadSize ?? DEFAULT_MAX_UPLOAD_SIZE,
      writeBytes: (key, data, mimeType) => files.ref(key).write(data, mimeType),
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
  if (outcome.kind === "rejected") return fileRejectedFailure(outcome.error);

  const { uploaded } = outcome;
  return {
    isSuccess: true,
    data: uploaded,
    // Also runs after a failed COMMIT whose outcome is unknown: a committed row must keep its binary.
    release: async () => {
      const committedRow = await fetchOne(ctx.db, fileRefsTable, {
        storageKey: uploaded.storageKey,
      });
      if (!committedRow) await files.ref(uploaded.storageKey).delete();
    },
  };
}

// Transaction half: creates the fileRef row for bytes uploadFileBytesBeforeTransaction wrote.
export async function createFileRefFromUploadedBytes(
  ctx: Pick<CreateFileRefContext, "db" | "user">,
  uploaded: UploadedFileBytes,
): Promise<WriteResult<CreatedFileRef>> {
  const ownPrefix = `${ctx.user.tenantId}/`;
  if (!uploaded.storageKey.startsWith(ownPrefix)) {
    return writeFailure(
      new InternalError({
        message: "createFileRefFromUploadedBytes: storageKey is outside the caller's tenant prefix",
      }),
    );
  }
  try {
    assertSafeStorageKey(uploaded.storageKey);
  } catch (error) {
    return writeFailure(
      new InternalError({
        message: "createFileRefFromUploadedBytes: unsafe storageKey",
        ...(error instanceof Error && { cause: error }),
      }),
    );
  }
  const row = await createFileRefRow({ user: ctx.user, tenantDb: ctx.db }, uploaded);
  return "failure" in row ? row.failure : { isSuccess: true, data: row.fileRef };
}
