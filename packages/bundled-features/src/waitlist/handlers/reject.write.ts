import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import {
  InternalError,
  NotFoundError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { WAITLIST_STATUS, WaitlistErrors } from "../constants.js";
import { isOpenWaitlistStatus } from "../entity.js";
import { adminAccess, platformActor, waitlistDb, waitlistExecutor } from "../lib.js";
import { WaitlistIdSchema } from "../payloads.js";

export type WaitlistRejectData = { readonly kind: "rejected"; readonly id: string };

export const rejectHandler = defineWriteHandler<
  "reject",
  typeof WaitlistIdSchema,
  WaitlistRejectData
>({
  name: "reject",
  schema: WaitlistIdSchema,
  access: adminAccess,
  description:
    "Marks a pending or invited waitlist entry as rejected, used by admins to dismiss spam or noise; the row and its personal data stay until erased.",
  handler: async (event, ctx) => {
    const db = waitlistDb(ctx);
    const row = await waitlistExecutor.detail({ id: event.payload.id }, platformActor(), db);
    if (!row) return writeFailure(new NotFoundError("waitlistEntry", event.payload.id));
    const version = row["version"];
    if (typeof version !== "number") {
      throw new InternalError({ message: "waitlist:reject: malformed waitlist row" });
    }
    if (!isOpenWaitlistStatus(row["status"])) {
      return writeFailure(new UnprocessableError(WaitlistErrors.notRejectable));
    }
    const updated = await waitlistExecutor.update(
      { id: event.payload.id, version, changes: { status: WAITLIST_STATUS.Rejected } },
      platformActor(),
      db,
    );
    if (!updated.isSuccess) return updated;
    return { isSuccess: true, data: { kind: "rejected", id: event.payload.id } };
  },
});
