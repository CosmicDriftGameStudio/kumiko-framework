import type { SseBroker } from "@cosmicdrift/kumiko-framework/api";
import { createTenantDb, type DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { Registry, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { ChannelContext } from "./types";

// Build the per-tenant context a channel's resolve/render/send receives.
// Shared by the synchronous delivery-service path and the async job handlers
// (which pass sseBroker=undefined — only the inline inApp channel uses SSE,
// and it never runs through a job).
export function buildChannelContext(
  db: DbConnection,
  registry: Registry,
  sseBroker: SseBroker | undefined,
  tenantId: TenantId,
): ChannelContext {
  return { db: createTenantDb(db, tenantId), registry, sseBroker, tenantId };
}
