// Cross-device try-first handover (kumiko-framework#3035 follow-up,
// offlot-app#454): signup-request runs in whichever browser the activation
// link ends up opened in, which may not be the one holding the anonymous
// visitor's tenant-handover grant. This extension point lets
// auth-email-password bind a verified grant to the signup token server-side
// — without knowing anything about tenant-handover's row-bound-grant
// mechanics — so signup-confirm can claim the data into the freshly
// provisioned tenant regardless of which browser it runs in.
//
// The grant itself never crosses this boundary: verifyGrant returns only
// the { entityType, rowId, sourceTenantId } binding, and mintClaim returns a
// freshly signed short-lived token rather than handing back the original.

import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";

export const EXT_SIGNUP_HANDOVER = "signupHandover" as const;

// Part of the contract: a provider's minted claim write may reject two
// different ways. Benign — this code, nothing was written (forged,
// expired, or already spent) — a caller redeeming the claim nested in its
// own write can log and carry on. Anything else means the provider's write
// already applied a PARTIAL change before failing (e.g. a root row moved
// but a declared child couldn't) — the caller must roll its own work back
// together with it, never treat that as a skippable no-op.
export const SIGNUP_HANDOVER_BENIGN_CLAIM_REJECTION_CODE = "invalid_or_expired_grant" as const;

export type SignupHandoverBinding = {
  readonly entityType: string;
  readonly rowId: string;
  readonly sourceTenantId: string;
};

export type SignupHandoverProvider = {
  verifyGrant(args: {
    readonly db: DbRunner;
    readonly registry: Registry;
    readonly entityType: string;
    readonly token: string;
  }): Promise<SignupHandoverBinding | null>;
  mintClaim(binding: SignupHandoverBinding): {
    readonly qualifiedName: string;
    readonly payload: { readonly token: string; readonly entityType: string };
  };
};

export function isSignupHandoverProvider(options: unknown): options is SignupHandoverProvider {
  return (
    typeof options === "object" &&
    options !== null &&
    typeof (options as Record<string, unknown>)["verifyGrant"] === "function" &&
    typeof (options as Record<string, unknown>)["mintClaim"] === "function"
  );
}

export function findSignupHandoverProvider(registry: Registry): SignupHandoverProvider | undefined {
  for (const usage of registry.getExtensionUsages(EXT_SIGNUP_HANDOVER)) {
    if (isSignupHandoverProvider(usage.options)) return usage.options;
  }
  return undefined;
}

declare module "@cosmicdrift/kumiko-framework/engine" {
  interface KumikoExtensionOptionsMap {
    [EXT_SIGNUP_HANDOVER]: SignupHandoverProvider;
  }
}
