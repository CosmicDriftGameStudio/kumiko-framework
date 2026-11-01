import {
  type HandlerContext,
  type SessionUser,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { copyPendingFileRefsToTenant } from "@cosmicdrift/kumiko-framework/files";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import { fileContextForTenant } from "../../file-foundation/index.ts";
import { helpdeskDb, platformActor } from "../lib.ts";
import { HELPDESK_UPLOAD_FIELD } from "../web/constants.ts";

// The form uploads into the submitter's tenant; the request or reply lives in the system tenant.
export async function takeOverUploads(
  ctx: HandlerContext,
  args: {
    readonly user: SessionUser;
    readonly screen: string;
    readonly entityType: string;
    readonly entityId: string;
    readonly fileIds: readonly string[];
  },
): Promise<WriteResult<readonly string[]>> {
  if (args.fileIds.length === 0) return { isSuccess: true, data: [] };
  const db = helpdeskDb(ctx);
  const submitterTenantId = args.user.tenantId;
  return copyPendingFileRefsToTenant({
    source: {
      db,
      user: args.user,
      files: fileContextForTenant(ctx, submitterTenantId, submitterTenantId),
      entityType: args.screen,
      fieldName: HELPDESK_UPLOAD_FIELD,
    },
    target: {
      db,
      user: platformActor(),
      registry: ctx.registry,
      files: fileContextForTenant(ctx, submitterTenantId, SYSTEM_TENANT_ID),
      attachTo: {
        entityType: args.entityType,
        fieldName: HELPDESK_UPLOAD_FIELD,
        entityId: args.entityId,
      },
    },
    fileIds: args.fileIds,
  });
}
