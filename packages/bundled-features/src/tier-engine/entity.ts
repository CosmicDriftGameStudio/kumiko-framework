import {
  createEntity,
  createSelectField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";
import { type TierAssignmentSource, TierAssignmentSources } from "./web/constants.ts";

// tier-assignment — exactly one aggregate per platform tenant. The aggregate ID
// is derived deterministically from tenantId (uuidv5; see aggregate-id.ts).
//
// **Tenant scope:** applied automatically by Kumiko's tenant-scoped projection —
// the framework adds `tenantId` as a base column, and the CrudExecutor populates
// it from `event.user.tenantId`. Each platform tenant has exactly one
// Tier-Assignment row.
//
// **Fields**
//   - tier: a TierName string (for example, "free", "pro", "business",
//     "enterprise", or "self-host"). The app defines valid tier values in its
//     TierMap (see compose-app.ts); the engine has no enumerated tier list.
//
// **Intentionally omitted from the entity**
//   - tenantId: added automatically as a base column.
//   - validFrom/validTo: redundant for event sourcing (events carry timestamps
//     natively; time travel uses `ctx.loadAggregate({ asOf })`).
//   - addOns: represented by a separate `tier-add-on` entity (1:n relation),
//     allowing event-sourced Add/Remove events with clear audit granularity
//     instead of replacing a JSON array.
//   - Cap values: per-tier cap definitions belong in the app's TierMap.
export const tierAssignmentEntity = createEntity({
  table: "read_tier_assignments",
  description:
    "The pricing tier currently assigned to a tenant, plus where the assignment came from (manual grant, billing sync or signup default) — one row per tenant.",
  fields: {
    tier: createTextField({
      required: true,
      maxLength: 50,
      personal: false,
      reason: "catalog_label",
    }),
    // Origin of the assignment, see TierAssignmentSources. Optional for back-compat with
    // rows without source. Protects manual grants from being overwritten by the billing sync.
    source: createSelectField({
      options: Object.values(TierAssignmentSources),
      required: false,
      personal: false,
      reason: "technical_reference",
    }),
  },
});

export type TierAssignmentRow = {
  readonly id: string;
  readonly version: number;
  readonly tier: string;
  readonly source: TierAssignmentSource | null;
  readonly tenantId: string;
};
