import type { HandlerContext, SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { currentNotificationType } from "./notification-type-aliases.ts";
import { upsertPreference } from "./upsert-preference.ts";

type PreferencePayload = {
  readonly userId: string;
  readonly notificationType: string;
  readonly channel: string;
};

// userId comes from the payload, not event.user.id — the caller is the system user
// dispatchSystemWrite runs as, not the user (un)subscribing.
export async function setPreferenceEnabled(
  handlerName: string,
  event: { readonly payload: PreferencePayload; readonly user: SessionUser },
  ctx: Pick<HandlerContext, "registry" | "systemDb">,
  enabled: boolean,
) {
  const { userId, channel } = event.payload;
  const notificationType = currentNotificationType(ctx.registry, event.payload.notificationType);
  const { tenantId } = event.user;

  if (!ctx.systemDb) {
    throw new InternalError({
      message: `${handlerName}: ctx.systemDb missing on a system-scoped handler`,
    });
  }
  const db = ctx.systemDb.assertTenantMatch(tenantId);

  const result = await upsertPreference(db, event.user, {
    tenantId,
    userId,
    notificationType,
    channel,
    enabled,
  });
  if (!result.isSuccess) return result;
  return { isSuccess: true, data: { notificationType, channel } } as const;
}
