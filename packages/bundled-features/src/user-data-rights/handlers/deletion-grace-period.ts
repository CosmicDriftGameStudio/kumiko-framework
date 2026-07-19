import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { addDurationSpec, type DurationSpec } from "@cosmicdrift/kumiko-framework/compliance";
import { createSystemUser, type HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
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

// Flippt einen aktiven User auf DeletionRequested + setzt gracePeriodEnd aus
// dem Compliance-Profile. Geteilt zwischen dem authentifizierten
// request-deletion-Pfad (event.user) und dem anonymen confirm-by-token-Pfad
// (userId aus verifiziertem Token) — eine Quelle für die Grace-Period-Logik.
//
// `complianceTenantId`: Tenant dessen Compliance-Profile die Grace-Dauer
// liefert. Authenticated = aktiver Tenant des Users; anonym = Dispatch-Tenant
// der Apex-Surface. Die User-Row ist tenant-agnostisch (Account-weite
// Löschung), nur die Grace-Dauer ist tenant-konfiguriert.
export async function startDeletionGracePeriod(
  ctx: HandlerContext,
  userId: string,
  complianceTenantId: string,
): Promise<StartGracePeriodResult> {
  const userRow = await fetchOne<{ status: string; email: string; locale: string | null }>(
    ctx.db.raw,
    userTable,
    { id: userId },
  );
  if (!userRow) {
    return {
      ok: false,
      error: new UnprocessableError("user_not_found", {
        details: { reason: "user_not_found", userId },
      }),
    };
  }
  if (userRow["status"] !== USER_STATUS.Active) {
    return {
      ok: false,
      error: new UnprocessableError("user_not_in_active_state", {
        details: { reason: "user_not_in_active_state", currentStatus: userRow["status"] },
      }),
    };
  }

  // @cast-boundary engine-payload — queryAs liefert unknown, narrow auf den
  // effektiven Profile-Shape (siehe request-deletion-Original).
  const profile = (await ctx.queryAs(
    createSystemUser(complianceTenantId),
    "compliance-profiles:query:for-tenant",
    {},
  )) as { profile: { userRights: { gracePeriod: DurationSpec } } };

  const gracePeriod = profile.profile.userRights.gracePeriod;
  const T = getTemporal();
  const gracePeriodEnd = addDurationSpec(T.Now.instant(), gracePeriod);

  await updateUserLifecycle(ctx.db.raw, userId, {
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
