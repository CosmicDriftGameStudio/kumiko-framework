import { addDurationSpec, type DurationSpec } from "@cosmicdrift/kumiko-framework/compliance";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { decryptStoredPii } from "../../shared";
import { USER_STATUS, userTable } from "../../user";
import { updateUserLifecycle } from "../lib/update-user-lifecycle";

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

export type StartGracePeriodResult =
  | {
      readonly ok: true;
      readonly gracePeriodEnd: Instant;
      readonly userEmail: string;
      readonly userLocale: string | null;
    }
  | { readonly ok: false; readonly error: UnprocessableError };

// Flips an active user to DeletionRequested and sets gracePeriodEnd from the
// caller-supplied grace period. Shared between the authenticated
// request-deletion path (event.user) and the anonymous confirm-by-token path
// (userId from a verified token) — one source for the grace-period logic.
//
// The user row is tenant-agnostic (account-wide deletion), so it is read via
// ctx.db.global(userTable); only the grace period duration is tenant-configured.
//
// `gracePeriod` and `lifecycleRunner` are resolved by the caller: both
// require an escalation (reading the tenant compliance profile, appending to
// the SYSTEM_TENANT_ID user stream) that only the declaring handler's
// escapeHatch covers.
export async function startDeletionGracePeriod(
  ctx: HandlerContext,
  userId: string,
  gracePeriod: DurationSpec,
  lifecycleRunner: DbRunner,
): Promise<StartGracePeriodResult> {
  const userRow = await ctx.db
    .global(userTable)
    .fetchOne<{ status: string; email: string; locale: string | null }>({ id: userId });
  if (!userRow) {
    return {
      ok: false,
      error: new UnprocessableError("user_not_found", {
        details: { userId },
      }),
    };
  }
  if (userRow["status"] !== USER_STATUS.Active) {
    return {
      ok: false,
      error: new UnprocessableError("user_not_in_active_state", {
        details: { currentStatus: userRow["status"] },
      }),
    };
  }

  const T = getTemporal();
  const gracePeriodEnd = addDurationSpec(T.Now.instant(), gracePeriod);

  await updateUserLifecycle(lifecycleRunner, userId, {
    status: USER_STATUS.DeletionRequested,
    gracePeriodEnd,
  });

  return {
    ok: true,
    gracePeriodEnd,
    userEmail: userRow["email"]
      ? await decryptStoredPii(userRow["email"], "email", "user-data-rights:grace-period")
      : "",
    userLocale: userRow["locale"] ?? null,
  };
}
