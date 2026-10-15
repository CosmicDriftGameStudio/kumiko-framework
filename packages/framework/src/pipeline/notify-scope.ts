import type { TenantId } from "../engine/types/identifiers.js";
import type {
  NotifyDispatched,
  NotifyFn,
  NotifyOptions,
  NotifyResult,
} from "../engine/types/index.js";
import { AccessDeniedError, FrameworkReasons } from "../errors/index.js";
import type { AfterCommitHook } from "./dispatcher-utils.js";

function isTenantBroadcast(to: NotifyOptions["to"]): to is { readonly tenant: TenantId } {
  return typeof to === "object" && to !== null && !Array.isArray(to) && "tenant" in to;
}

export function assertNotifyTargetsOwnTenant(options: NotifyOptions, tenantId: TenantId): void {
  const { to } = options;
  if (!isTenantBroadcast(to) || to.tenant === tenantId) return;
  throw new AccessDeniedError({
    message: "ctx.notify can only broadcast to the caller's own tenant",
    details: { reason: FrameworkReasons.notifyForeignTenantBroadcast },
  });
}

type DeferringNotifyDeps = {
  readonly tenantId: TenantId;
  readonly notifyAfterCommit: NotifyFn;
  readonly notifyNow: NotifyFn;
  readonly scheduleAfterCommit: (hook: AfterCommitHook) => void;
};

// Without `immediate`, a notify inside a write transaction waits for the commit so a
// rolled-back write leaves no notification behind.
export function createDeferringNotify(deps: DeferringNotifyDeps): NotifyFn {
  const { tenantId, notifyAfterCommit, notifyNow, scheduleAfterCommit } = deps;
  async function notifyDeferringUntilCommit(
    notificationType: string,
    options: NotifyOptions & { readonly immediate: true },
  ): Promise<NotifyDispatched>;
  async function notifyDeferringUntilCommit(
    notificationType: string,
    options: NotifyOptions,
  ): Promise<NotifyResult>;
  async function notifyDeferringUntilCommit(
    notificationType: string,
    options: NotifyOptions,
  ): Promise<NotifyResult> {
    assertNotifyTargetsOwnTenant(options, tenantId);
    if (options.immediate === true) return notifyNow(notificationType, options);
    scheduleAfterCommit(async () => {
      await notifyAfterCommit(notificationType, options);
    });
    return { kind: "deferred" };
  }
  return notifyDeferringUntilCommit;
}
