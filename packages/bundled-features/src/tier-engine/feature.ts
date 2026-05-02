// tier-engine — Pricing-Tier-Mechanik als reguläres Bundled-Feature.
//
// **Was diese Feature macht:**
//   Speichert pro Plattform-Tenant ein Tier-Assignment (welcher Tier ist
//   aktiv). composeApp-Helper liest diesen Stand und leitet daraus ab,
//   welche Features für den Tenant gemountet werden.
//
// **Generic über Tier-Werte:** das Feature kennt keine "free"/"pro"/etc.
//   konkreten Tier-Werte. Es speichert nur den Tier-Namen als String. Die
//   App definiert ihre TierMap (siehe compose-app.ts), damit kumiko.so,
//   PublicStatus, und andere Kumiko-Apps je eigene Tier-Sets nutzen können.
//
// **Standard-CRUD-Handler in Sprint 1:** Create/Update/List/Detail per
//   `defineEntityXxxHandler`. Idempotente set-tier-Logic (deterministic
//   aggregate-id, create-or-update-Routing) kommt im stripe-sync-Feature
//   in Sprint 5 als Wrapper darum.
//
// **Tenant-Scope:** tier-engine ist tenant-scoped. Plattform-Tenant verwaltet
//   seinen eigenen Tier (Self-Service-Upgrade-UI). Stripe-Webhook (Sprint 5)
//   wird im stripe-sync-Feature die tenant-resolution machen und den
//   tier-assignment:create/update-Handler mit dem aufgelösten Context
//   aufrufen.
//
// **Was Sprint 1 NICHT macht:**
//   - Custom Domain-Events (`tier-changed`) — emittiert werden derzeit nur
//     die CRUD-Auto-Events. Sprint 4 (Add-On-Marketplace) erweitert das auf
//     semantische Domain-Events.
//   - Add-Ons im Schema — Sprint 4 fügt sie als separate
//     `tier-add-on`-Entity hinzu (1:n Relation, ES-saubere Add/Remove-Events).
//   - Cap-Counter-Integration — kommt mit `cap-counter`-Feature in Sprint 3.
//   - Stripe-Sync + Idempotent-Set-Tier-Wrapper — kommt mit `stripe-sync`-
//     Feature in Sprint 5.
//
// **Boot-Dependencies:**
//   r.requires("config") — transitiv für tenant.
//   r.requires("tenant") — tier-assignment lebt im Plattform-Tenant-Kontext.

import {
  defineEntityCreateHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
  type FeatureDefinition,
} from "@kumiko/framework/engine";
import { TIER_ENGINE_FEATURE } from "./constants";
import { tierAssignmentEntity } from "./entity";
import { getActiveTierQuery } from "./handlers/active-tier.query";

const adminAccess = { access: { roles: ["TenantAdmin", "SystemAdmin"] } } as const;

export const tierEngineFeature: FeatureDefinition = defineFeature(TIER_ENGINE_FEATURE, (r) => {
  r.requires("config");
  r.requires("tenant");

  r.entity("tier-assignment", tierAssignmentEntity);

  // Standard-CRUD via Helper. Sprint 5 wraps these in a custom set-tier
  // handler with deterministic aggregate-id for Stripe-Webhook idempotency.
  r.writeHandler(defineEntityCreateHandler("tier-assignment", tierAssignmentEntity, adminAccess));
  r.writeHandler(defineEntityUpdateHandler("tier-assignment", tierAssignmentEntity, adminAccess));

  // Reads.
  //   - list: cross-tenant view for SystemAdmin (debug/migration-tooling)
  //     and per-tenant 0-or-1-row view for TenantAdmin (auto-tenant-scoped)
  //   - get-active-tier: convenience-wrapper for the only sensible per-tenant
  //     query — returns the single row or null. composeApp consumes this.
  //
  // Detail-by-id-handler bewusst weggelassen — kein Use-Case, weil pro Tenant
  // genau eine Row existiert; get-active-tier ist die richtige Lookup-Form.
  r.queryHandler(defineEntityListHandler("tier-assignment", tierAssignmentEntity, adminAccess));
  r.queryHandler(getActiveTierQuery);
});
