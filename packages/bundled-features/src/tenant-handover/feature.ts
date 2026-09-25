import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { EXT_SIGNUP_HANDOVER } from "../shared";
import { TENANT_HANDOVER_CLAIMED_EVENT_SHORT, tenantHandoverClaimedSchema } from "./events";
import {
  type ClaimTenantHandoverOptions,
  createClaimTenantHandoverHandler,
} from "./handlers/claim.write";
import { createSignupHandoverProvider } from "./signup-handover-provider";

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

    // Self-extension: this feature both defines the signupHandover contract
    // and is its only implementation (self-extension is legitimate — an app
    // without auth-email-password's signup flow, or without this feature at
    // all, still boots; requires(self) would be circular). See
    // shared/signup-handover.ts for why this indirection exists instead of
    // auth-email-password importing tenant-handover directly.
    r.extendsRegistrar(EXT_SIGNUP_HANDOVER, {});
    r.useExtension(EXT_SIGNUP_HANDOVER, "tenant-handover", createSignupHandoverProvider(opts));
  });
}
