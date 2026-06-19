import { createEntity, createTextField } from "@cosmicdrift/kumiko-framework/engine";

// tier-assignment — pro Plattform-Tenant genau ein Aggregat. Aggregate-ID
// wird deterministisch aus tenantId abgeleitet (uuidv5, siehe aggregate-id.ts).
//
// **Tenant-Scope:** automatisch via Kumiko's tenant-scoped projection — die
// `tenantId`-Spalte wird vom Framework als Base-Column hinzugefügt, der
// CrudExecutor befüllt sie aus `event.user.tenantId`. Pro Plattform-Tenant
// gibt es genau eine Tier-Assignment-Row.
//
// **Felder**
//   - tier: TierName-String (z.B. "free", "pro", "business", "enterprise",
//     "self-host"). Welche Tier-Werte gültig sind, definiert die App in
//     ihrer TierMap (siehe compose-app.ts) — die Engine selbst hat keine
//     enumerierte Tier-Liste.
//
// **Was bewusst NICHT in der Entity steht**
//   - tenantId: kommt automatisch als Base-Column.
//   - validFrom/validTo: ES-redundant (Events tragen Timestamps nativ,
//     time-travel über `ctx.loadAggregate({ asOf })`).
//   - addOns: Sprint 1 hat keine Add-Ons. Sprint 4 fügt sie als separate
//     `tier-add-on`-Entity hinzu (1:n Relation, ES-saubere Add/Remove-Events
//     mit klarer Audit-Granularität statt JSON-Array-Replace).
//   - Caps-Werte: pro-Tier-Cap-Definitionen leben in der TierMap der App.
export const tierAssignmentEntity = createEntity({
  table: "read_tier_assignments",
  fields: {
    tier: createTextField({ required: true, maxLength: 50 }),
    // Woher das Assignment stammt: "manual" (Admin-Grant via tier-admin-Screen),
    // "stripe" (future Billing-Sync), "default" (auto-default-on-signup-Hook).
    // Optional für Back-Compat zu bestehenden Rows ohne source. Schützt manuelle
    // Grants davor, von einem späteren Stripe→Tier-Sync geplättet zu werden.
    source: createTextField({ required: false, maxLength: 20 }),
  },
});
