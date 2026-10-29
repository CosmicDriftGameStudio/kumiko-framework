import {
  createEntityExecutor,
  createSystemUser,
  type PreSaveHookFn,
  SYSTEM_ROLE,
  SYSTEM_USER_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError } from "@cosmicdrift/kumiko-framework/errors";
import { FILE_REF_ENTITY_NAME, fileRefEntity } from "@cosmicdrift/kumiko-framework/files";
import { DOCUMENT_ENTITY } from "./constants.ts";

const fileRefs = createEntityExecutor(FILE_REF_ENTITY_NAME, fileRefEntity).executor;

// One live document per file (unique on tenant + file): a member who names a colleague's pending
// upload would block the colleague's own later save of that file, because capture could no longer
// create its document. Files a job made (system uploader) and files already bound to a record stay
// allowed; for the latter the readGate's file-owner check covers it.
export const rejectForeignPendingFile: PreSaveHookFn = async (changes, ctx) => {
  const file = changes["file"];
  if (typeof file !== "string" || file === ctx.previous["file"]) return changes;
  if (ctx.user.roles.includes(SYSTEM_ROLE)) return changes;
  const ref = await fileRefs.detail({ id: file }, createSystemUser(ctx.user.tenantId), ctx.db);
  // skip: a missing file is rejected by the framework's own file-reference check
  if (ref === null) return changes;
  const uploader = ref["insertedById"];
  const unbound = ref["entityId"] === null || ref["entityId"] === undefined;
  if (
    unbound &&
    typeof uploader === "string" &&
    uploader !== ctx.user.id &&
    uploader !== SYSTEM_USER_ID
  ) {
    throw new NotFoundError(DOCUMENT_ENTITY, file);
  }
  return changes;
};
