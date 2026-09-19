import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { TENANT_HANDOVER_CLAIMED_EVENT_SHORT, tenantHandoverClaimedSchema } from "./events";
import {
  type ClaimTenantHandoverOptions,
  createClaimTenantHandoverHandler,
} from "./handlers/claim.write";

export type TenantHandoverFeatureOptions = ClaimTenantHandoverOptions;

// tenant-handover — Option A from kumiko-framework#3035: the ONE write a
// try-before-signup (or guest-checkout, demo-to-account) flow needs once an
// anonymous run is done and the visitor has a fresh tenant. No general
// tenant-merge tool, no copy — this is an ownership change on rows a
// declared-transferable entity graph already points at.
export function createTenantHandoverFeature(
  opts: TenantHandoverFeatureOptions = {},
): FeatureDefinition {
  return defineFeature("tenant-handover", (r) => {
    r.describe(
      "Try-before-signup ownership handover: claims the rows of a declared-transferable " +
        "entity graph (root plus its parentRef-linked children) from an anonymous/public " +
        "tenant into the caller's own tenant, legitimized by a row-bound grant the anonymous " +
        "flow minted. Idempotent, audited via a `<entityType>.tenantHandover` domain event.",
    );
    r.uiHints({
      displayLabel: "Tenant Handover",
      category: "identity",
      recommended: false,
    });
    r.defineEvent(TENANT_HANDOVER_CLAIMED_EVENT_SHORT, tenantHandoverClaimedSchema, {
      piiFields: "none",
    });
    r.writeHandler(createClaimTenantHandoverHandler(opts));
  });
}
