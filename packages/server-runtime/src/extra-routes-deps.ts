import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type Registry,
  type SessionUser,
  type TenantId,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import type Redis from "ioredis";

/** Deps für `extraRoutes` — geteilt zwischen runProdApp (prod) und
 *  createKumikoServer (dev), damit die beiden Pfade nicht driften.
 *  Naming: `deps` statt `ctx` weil im Framework `ctx` der HandlerContext
 *  mit user/tenant/registry ist — hier ist der Scope absichtlich kleiner
 *  (Routes laufen außerhalb der Auth/Tenant-Pipeline). */
export type ExtraRoutesSystemDeps = {
  readonly db: DbConnection;
  readonly redis: Redis;
  /** Feature-registry — z.B. für Plugin-Lookups via
   *  `registry.getExtensionUsages("subscriptionProvider")`. */
  readonly registry: Registry;
  /** Schreibt durch den /api/*-Command-Dispatcher (gleiche Idempotency/
   *  Job-Hooks) — aber als auto-konstruierter SystemAdmin des Ziel-
   *  Tenants, OHNE Access-Check der Route. Privilege-Scope: SystemAdmin
   *  ist die höchste nicht-tenant-scoped Rolle — der Call erreicht JEDEN
   *  SystemAdmin-gegateten Handler auf jedem Tenant; das Rollen-Set ist
   *  nicht konfigurierbar. Nur für Pfade, die ihre Authentizität selbst
   *  beweisen (Provider-Webhook-Signaturen,
   *  createSubscriptionWebhookHandler et al.). */
  readonly dispatchSystemWrite: (args: {
    readonly handlerQn: string;
    readonly payload: unknown;
    readonly tenantId: TenantId;
  }) => Promise<WriteResult>;
};

type SystemWriteDispatcher = {
  readonly write: (handlerQn: string, payload: unknown, user: SessionUser) => Promise<WriteResult>;
};

export function makeDispatchSystemWrite(
  dispatcher: SystemWriteDispatcher,
): ExtraRoutesSystemDeps["dispatchSystemWrite"] {
  return ({ handlerQn, payload, tenantId }) =>
    dispatcher.write(handlerQn, payload, createSystemUser(tenantId, [ROLES.SystemAdmin]));
}
