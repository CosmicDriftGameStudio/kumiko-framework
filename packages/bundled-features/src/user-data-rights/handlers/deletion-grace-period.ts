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
// That read only supplies email/locale for the caller's notification — it is
// NOT the transition's guard. The guard is `expect: { status: Active }` on
// the lifecycle write itself (#3024): the executor re-checks it against a
// fresh row right before writing, so a concurrent caller that already moved
// the user off Active is rejected even though this read saw Active.
//
// `additionalExpect` lets a caller fold its own precondition into the SAME
// atomic write — the confirm-by-token path uses it to spend a row-bound
// grant's anchor (pendingDeletionRequestId) in the same statement that flips
// status, per shared/row-bound-grant.ts's "write in the same statement that
// spends the anchor" contract. The write also always clears
// pendingDeletionRequestId: a request-by-email token is meant for one
// confirm only, and leaving the id in place would let it re-arm later if
// something ever moves the user back to Active without going through
// cancel-deletion's explicit null (restrict/lift-restriction can't today,
// since status is a single field and Restricted/DeletionRequested are
// mutually exclusive — but nulling it here doesn't depend on that staying
// true). No-op for the authenticated request-deletion path, which never set
// a pendingDeletionRequestId to begin with.
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
  additionalExpect?: Readonly<Record<string, string | number | boolean | null>>,
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

  const T = getTemporal();
  const gracePeriodEnd = addDurationSpec(T.Now.instant(), gracePeriod);

  const { applied } = await updateUserLifecycle(
    lifecycleRunner,
    userId,
    { status: USER_STATUS.DeletionRequested, gracePeriodEnd, pendingDeletionRequestId: null },
    { expect: { status: USER_STATUS.Active, ...additionalExpect } },
  );
  if (!applied) {
    return {
      ok: false,
      error: new UnprocessableError("user_not_in_active_state", {
        details: { currentStatus: userRow["status"] },
      }),
    };
  }

  return {
    ok: true,
    gracePeriodEnd,
    userEmail: userRow["email"]
      ? await decryptStoredPii(userRow["email"], "email", "user-data-rights:grace-period")
      : "",
    userLocale: userRow["locale"] ?? null,
  };
}
