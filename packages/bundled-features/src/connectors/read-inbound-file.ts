import type { HandlerContext, JobContext, SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { isUuid } from "@cosmicdrift/kumiko-framework/engine";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  FileRefTooLargeError,
  fileContextForTenant,
  readFileRefContent,
} from "../file-foundation/index.ts";
import { connectorExecutor } from "./schema/connector.ts";
import { inboundItemExecutor } from "./schema/inbound-item.ts";

export type ReadInboundFileContext =
  | Pick<HandlerContext, "db" | "services" | "user">
  | Pick<JobContext, "db" | "services" | "systemUser">;

export type InboundFile = {
  readonly inboundItemId: string;
  readonly connectorId: string;
  /** Null when the connector no longer exists. */
  readonly connectorName: string | null;
  /** Decrypted path below the connector's source, "/"-separated. */
  readonly relativePath: string;
  readonly sha256: string;
  readonly sourceModifiedAt: Temporal.Instant;
  readonly bytes: Uint8Array;
};

export const INBOUND_FILE_FAILURE = { notFound: "not-found", tooLarge: "too-large" } as const;
export type InboundFileFailure = (typeof INBOUND_FILE_FAILURE)[keyof typeof INBOUND_FILE_FAILURE];

export type ReadInboundFileResult =
  | { readonly isSuccess: true; readonly data: InboundFile }
  | { readonly isSuccess: false; readonly failure: InboundFileFailure };

function acting(ctx: ReadInboundFileContext): SessionUser {
  return "systemUser" in ctx ? ctx.systemUser : ctx.user;
}

// Reads through the tenant-scoped db and file context of the caller, so another tenant's item, a deleted
// item and a missing file all answer not-found. The size limit is checked against the stored size before any byte is read.
export async function readInboundFile(
  ctx: ReadInboundFileContext,
  inboundItemId: string,
  options: { readonly maxBytes: number },
): Promise<ReadInboundFileResult> {
  const notFound = { isSuccess: false, failure: INBOUND_FILE_FAILURE.notFound } as const;
  if (!isUuid(inboundItemId)) return notFound;
  const user = acting(ctx);
  const item = await inboundItemExecutor.detail({ id: inboundItemId }, user, ctx.db);
  if (!item || typeof item.fileRefId !== "string") return notFound;

  let content: Awaited<ReturnType<typeof readFileRefContent>>;
  try {
    content = await readFileRefContent({
      db: ctx.db,
      filesForTenant: (ownerTenantId) => fileContextForTenant(ctx, user.tenantId, ownerTenantId),
      fileRefId: item.fileRefId,
      allowedTenantIds: [user.tenantId],
      maxBytes: options.maxBytes,
    });
  } catch (error) {
    if (error instanceof FileRefTooLargeError) {
      return { isSuccess: false, failure: INBOUND_FILE_FAILURE.tooLarge };
    }
    throw error;
  }
  if (content === null) return notFound;

  const connector = await connectorExecutor.detail({ id: item.connectorId }, user, ctx.db);
  return {
    isSuccess: true,
    data: {
      inboundItemId,
      connectorId: item.connectorId,
      connectorName: connector ? connector.name : null,
      relativePath: item.relativePath,
      sha256: item.sha256,
      sourceModifiedAt: item.sourceModifiedAt,
      bytes: content.content,
    },
  };
}
