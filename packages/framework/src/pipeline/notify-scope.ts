import { assertNotificationVariables } from "../engine/template-variables.js";
import type { TenantId } from "../engine/types/identifiers.js";
import type {
  NotifyDispatched,
  NotifyFn,
  NotifyOptions,
  NotifyResult,
  Registry,
} from "../engine/types/index.js";
import { AccessDeniedError, FrameworkReasons } from "../errors/index.js";
import type { AfterCommitHook } from "./dispatcher-utils.js";

function isTenantBroadcast(to: NotifyOptions["to"]): to is { readonly tenant: TenantId } {
  return typeof to === "object" && to !== null && !Array.isArray(to) && "tenant" in to;
}

export function assertNotifyTargetsOwnTenant(options: NotifyOptions, tenantId: TenantId): void {
  const { to } = options;
  if (isTenantBroadcast(to) && to.tenant !== tenantId) {
    throw new AccessDeniedError({
      message: "ctx.notify can only broadcast to the caller's own tenant",
      details: { reason: FrameworkReasons.notifyForeignTenantBroadcast },
    });
  }
}

type DeferringNotifyDeps = {
  readonly registry: Pick<Registry, "getAllNotifications"> | undefined;
  readonly tenantId: TenantId;
  readonly notifyAfterCommit: NotifyFn;
  readonly notifyNow: NotifyFn;
  readonly scheduleAfterCommit: (hook: AfterCommitHook) => void;
};

// Without `immediate`, a notify inside a write transaction waits for the commit so a
// rolled-back write leaves no notification behind.
export function createDeferringNotify(deps: DeferringNotifyDeps): NotifyFn {
  const { registry, tenantId, notifyAfterCommit, notifyNow, scheduleAfterCommit } = deps;
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
    // Fail the write now: after the commit the problem would only surface in the render job.
    if (registry) assertNotificationVariables(registry, notificationType, options.data);
    if (options.immediate === true) return notifyNow(notificationType, options);
    // The hook runs after the handler returned; a caller reusing `data` meanwhile must not change what is sent.
    const optionsAtCallTime = structuredClone(options);
    scheduleAfterCommit(async () => {
      await notifyAfterCommit(notificationType, optionsAtCallTime);
    });
    return { kind: "deferred" };
  }
  return notifyDeferringUntilCommit;
}
