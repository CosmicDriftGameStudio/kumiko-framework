import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { deleteRowsWithoutReplayableStream } from "@cosmicdrift/kumiko-framework/event-store";
import { inboundMessagesProjectionTable } from "./projection.ts";

export type PurgeableMessageRow = { readonly id: string; readonly bodyRef: string | null };

export interface PurgeInboundMessagesArgs {
  readonly db: Parameters<typeof deleteRowsWithoutReplayableStream>[0];
  readonly tenantId: TenantId;
  readonly rows: readonly PurgeableMessageRow[];
  readonly archive: (messageId: string) => Promise<void>;
  readonly deleteBodyObject?: ((bodyRef: string) => Promise<void>) | undefined;
  readonly deleteAttachments?: ((messageId: string) => Promise<void>) | undefined;
}

export interface PurgeInboundMessagesResult {
  readonly purgedIds: readonly string[];
  readonly failedIds: readonly string[];
  readonly bodyObjectsDeleted: number;
}

// Archive first, delete the row last and strictly by the archived ids: a crash in between leaves an
// archived stream the next run finishes, and a row is never deleted while its stream could replay.
// A row whose body or attachment delete fails stays, otherwise the only reference to the object is lost.
export async function purgeInboundMessages(
  args: PurgeInboundMessagesArgs,
): Promise<PurgeInboundMessagesResult> {
  const purgedCandidates: string[] = [];
  const failedIds: string[] = [];
  let bodyObjectsDeleted = 0;
  for (const row of args.rows) {
    await args.archive(row.id);
    try {
      if (row.bodyRef && args.deleteBodyObject) {
        await args.deleteBodyObject(row.bodyRef);
        bodyObjectsDeleted++;
      }
      await args.deleteAttachments?.(row.id);
    } catch {
      failedIds.push(row.id);
      continue;
    }
    purgedCandidates.push(row.id);
  }
  const purgedIds =
    purgedCandidates.length === 0
      ? []
      : await deleteRowsWithoutReplayableStream(args.db, {
          table: inboundMessagesProjectionTable,
          ids: purgedCandidates,
          tenantId: args.tenantId,
        });
  return { purgedIds, failedIds, bodyObjectsDeleted };
}
