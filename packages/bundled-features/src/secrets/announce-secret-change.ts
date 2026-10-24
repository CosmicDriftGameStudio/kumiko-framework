import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  CACHE_SYNC_TOPICS,
  type CacheSyncBus,
  type TenantConfigSyncMessage,
} from "@cosmicdrift/kumiko-framework/redis";

type AnnouncingContext = {
  readonly services: { readonly cacheSync?: CacheSyncBus };
  readonly lifecycle: { readonly afterCommit?: (hook: () => Promise<void>) => void };
};

// Secret writes bypass config:write:*, yet provider caches (e.g. the S3 secret
// key) depend on them: announce on the tenant-config topic, after commit so a
// replica reloading on the message sees the new value.
export function announceSecretChange(
  ctx: AnnouncingContext,
  tenantId: TenantId,
  key: string,
): void {
  const bus = ctx.services.cacheSync;
  // skip: no bus wired (single-process setup), nothing to announce
  if (!bus) return;
  const message: TenantConfigSyncMessage = { tenantId, key };
  const publish = async (): Promise<void> => {
    bus.publish(CACHE_SYNC_TOPICS.tenantConfig, message);
  };
  if (ctx.lifecycle.afterCommit) ctx.lifecycle.afterCommit(publish);
  else bus.publish(CACHE_SYNC_TOPICS.tenantConfig, message);
}
