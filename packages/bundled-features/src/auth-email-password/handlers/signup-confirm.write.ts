// Magic-Link signup, step 2 (confirmation).
//
// Token from the URL + password from the user → redeem the token in Redis
// and atomically create the tenant, user, and TenantAdmin membership.
// emailVerified is set to true immediately—the magic link IS the proof.
//
// Pipeline:
//   1. Redis check: token → email lookup
//   2. Single-use burn (SETNX)—only one of two simultaneous tab clicks wins
//   3. Generate the tenant key (generateUniqueName with a DB isAvailable
//      check against tenants.key)
//   4. provisionSignupAccount: create the tenant, user, and membership in one
//      operation (through event-store-executor; events, projection, and MSPs
//      see this as a regular create)
//   5. Delete the token keys (the burn key remains for TTL replay protection)
//
// Failure recovery: every path after the burn checks the `committed` flag;
// when !committed, the burn is released so a legitimate retry is not blocked
// by a stale marker, as with reset/verify.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import {
  defineWriteHandler,
  type HandlerContext,
  type SessionUser,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  ConflictError,
  InternalError,
  reraiseAsKumikoError,
  type WriteErrorInfo,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { generateUniqueName } from "@cosmicdrift/kumiko-framework/random";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import * as z from "zod";
import {
  findSignupHandoverProvider,
  registrationLocaleFromRequest,
  SIGNUP_HANDOVER_BENIGN_CLAIM_REJECTION_CODE,
  type SignupHandoverBinding,
} from "../../shared/index.ts";
// kumiko-lint-ignore cross-feature-import signup-confirm reads tenants.key for slug-uniqueness check (TOCTOU + DB-unique-index zusammen)
import { tenantTable } from "../../tenant/schema/tenant.ts";
import { invalidSignupToken, signupEmailAlreadyRegistered } from "../errors.ts";
import { passwordSchema } from "../password-policy.ts";
// kumiko-lint-ignore cross-feature-import provisioning needs cross-feature seeding helpers
import { INITIAL_SIGNUP_ROLES, provisionSignupAccount } from "../seeding.ts";
import {
  burnSignupToken,
  deleteSignupHandover,
  deleteSignupToken,
  getEmailForSignupToken,
  getSignupHandover,
  unburnSignupToken,
} from "../signup-token-store.ts";
import { gateEnforceMfa, type LoginHandlerOptions, type LoginResult } from "./login.write.ts";

const SignupConfirmSchema = z.object({
  token: z.string().min(8),
  password: passwordSchema,
});

// Mirrors the login handler's session shape so the route treats a successful
// confirm like a login. tenantKey stays a sibling of the session: it is only
// for the post-signup redirect, SessionUser is generic. When the MFA gate
// applies, the MFA step is returned instead of a session.
export type SignupConfirmData =
  | {
      readonly kind: "auth-session";
      readonly session: SessionUser;
      readonly tenantKey: string;
      // Present only when a bound tenant-handover grant existed AND its claim
      // actually succeeded (see the handler body below).
      readonly handover?: { readonly entityType: string; readonly id: string };
    }
  | (Exclude<LoginResult, { readonly kind: "auth-session" }> & {
      // What the response needs to resolve the signup landing although no
      // session is issued yet.
      readonly signup: {
        readonly roles: readonly string[];
        readonly tenantId: TenantId;
        readonly tenantKey: string;
        readonly handover?: ClaimedHandover;
      };
    });

export type SignupConfirmOptions = Pick<LoginHandlerOptions, "mfaStatusChecker">;

const SIGNUP_CONFIRM_PROVISION_REASON =
  "provisions a new tenant, its first user and membership before any tenant context exists";

// UnprocessableError's `.code` is always the fixed literal "unprocessable" —
// the distinguishing reason slug lives in `details.reason` (see
// KumikoError's own reasonSlug getter in kumiko-error.ts). Comparing `.code`
// directly against SIGNUP_HANDOVER_BENIGN_CLAIM_REJECTION_CODE would never
// match; this reads the same field the framework itself uses.
function isBenignClaimRejection(error: WriteErrorInfo): boolean {
  return (
    isPlainObject(error.details) &&
    error.details["reason"] === SIGNUP_HANDOVER_BENIGN_CLAIM_REJECTION_CODE
  );
}

type ClaimedHandover = { readonly entityType: string; readonly id: string };

// Rides the caller's tx. A benign claim rejection (nothing was written) logs
// and yields undefined; any other failure — including a real DB error, which
// leaves the shared tx unusable regardless of catching it here — throws, so
// the whole signup rolls back instead of leaving a partially moved transfer
// graph next to a committed account.
async function claimBoundHandover(
  ctx: HandlerContext,
  session: SessionUser,
  binding: SignupHandoverBinding,
): Promise<ClaimedHandover | undefined> {
  const provider = findSignupHandoverProvider(ctx.registry);
  if (!provider) {
    ctx.obs.log?.warn(
      "signup-confirm: handover binding present but no signupHandover provider mounted",
    );
    return undefined;
  }
  const claim = provider.mintClaim(binding);
  const claimResult = await ctx.dispatch.writeAs(session, claim.qualifiedName, claim.payload);
  if (claimResult.isSuccess) return { entityType: binding.entityType, id: binding.rowId };
  if (!isBenignClaimRejection(claimResult.error)) throw reraiseAsKumikoError(claimResult.error);
  ctx.obs.log?.warn("signup-confirm: handover grant did not redeem", {
    entityType: binding.entityType,
  });
  return undefined;
}

export function createSignupConfirmHandler(opts: SignupConfirmOptions = {}) {
  return defineWriteHandler<"signup-confirm", typeof SignupConfirmSchema, SignupConfirmData>({
    name: "signup-confirm",
    schema: SignupConfirmSchema,
    access: { roles: ["anonymous"], personalData: "public-intake" },
    rateLimit: { per: "ip+handler", limit: 20, windowSeconds: 60 },
    agent: { expose: false },
    escapeHatch: {
      grants: ["unsafeRaw", "systemIdentity"],
      reason: SIGNUP_CONFIRM_PROVISION_REASON,
    },
    handler: async (event, ctx) => {
      if (!ctx.redis) {
        return writeFailure(
          new InternalError({
            message: "signup-confirm requires ctx.redis for token consumption",
          }),
        );
      }

      // Token lookup: nonexistent, expired, and already-consumed tokens all
      // collapse to invalid_signup_token to prevent enumeration.
      const email = await getEmailForSignupToken(ctx.redis, event.payload.token);
      if (!email) return invalidSignupToken();

      // Single-use burn: of two parallel confirmations from different tabs,
      // one succeeds and the other receives invalid_signup_token.
      const burn = await burnSignupToken(ctx.redis, event.payload.token);
      if (burn === "already-used") return invalidSignupToken();

      let committed = false;
      try {
        // Tenant key: a two-word slug from framework/random, with a DB conflict
        // check against tenants.key. 22,500 default combinations plus a
        // suffix fallback in case of collision (see generateUniqueName).
        // @cast-boundary db-runner — helpers use only the query API that
        // DbConnection and DbTx share.
        const dbConn = ctx.db.unsafeRaw() as DbConnection;

        const tenantKey = await generateUniqueName({
          isAvailable: async (slug) => {
            const existing = await fetchOne<{ id: string }>(dbConn, tenantTable, { key: slug });
            return existing === undefined;
          },
        });

        const tenantId = generateId() as TenantId; // @cast-boundary engine-payload
        // Use the email prefix as a meaningful default display name; the user can
        // change the tenant name and their own displayName later.
        const displayName = email.split("@")[0] ?? email;

        const registrationLocale = registrationLocaleFromRequest();

        let provisioned: { readonly userId: string; readonly tenantId: TenantId };
        try {
          provisioned = await provisionSignupAccount(
            dbConn,
            {
              email,
              password: event.payload.password,
              displayName,
              tenantId,
              tenantKey,
              // Generated slug as default name: no personal data (the email) in the tenant name.
              tenantName: tenantKey,
              ...registrationLocale,
            },
            // seedTenant's postSave hooks (tier-engine's auto-default-
            // tier, an app's auto-default-compliance) must fire on self-signup
            // exactly like they do on the regular TenantHandlers.create path.
            { registry: ctx.registry, context: ctx },
          );
        } catch (err) {
          // The email already has an account—provisionSignupAccount is create-only:
          // return a clean user error and never create a session for that account.
          // committed remains false, so finally releases the burn; a retry fails
          // the same way without being blocked by a stale marker.
          if (err instanceof ConflictError) return signupEmailAlreadyRegistered();
          throw err;
        }

        // Build the SessionUser for JWT minting. Use roles from INITIAL_SIGNUP_ROLES
        // so the database write (provisionSignupAccount) and session claim share
        // one source; otherwise two hardcoded "TenantAdmin" values could drift
        // during a refactor and create a role mismatch between the DB and JWT.
        const session: SessionUser = {
          id: provisioned.userId,
          tenantId: provisioned.tenantId,
          roles: [...INITIAL_SIGNUP_ROLES],
          ...registrationLocale,
        };

        // Claim BEFORE spending the signup token or the binding below and
        // before `committed` flips: if the claim throws, the `finally` still
        // unburns and the activation link stays retryable.
        const handoverBinding = await getSignupHandover(ctx.redis, event.payload.token);
        const handover = handoverBinding
          ? await claimBoundHandover(ctx, session, handoverBinding)
          : undefined;

        // Before the token keys go: a throwing MFA check must leave the link retryable.
        const mfaGate = await gateEnforceMfa(
          ctx,
          { mfaStatusChecker: opts.mfaStatusChecker },
          provisioned.userId,
          provisioned.tenantId,
          session.roles,
        );

        // Drop both token lookup keys; the burn key stays for its remaining
        // TTL as replay protection.
        await deleteSignupToken(ctx.redis, { email, token: event.payload.token });
        if (handoverBinding) await deleteSignupHandover(ctx.redis, event.payload.token);

        if (mfaGate !== undefined) {
          committed = true;
          return {
            isSuccess: true,
            data: {
              ...mfaGate,
              signup: {
                roles: session.roles,
                tenantId: provisioned.tenantId,
                tenantKey,
                ...(handover !== undefined && { handover }),
              },
            },
          };
        }

        committed = true;
        return {
          isSuccess: true,
          data: {
            kind: "auth-session",
            session,
            tenantKey,
            ...(handover !== undefined && { handover }),
          },
        };
      } finally {
        if (!committed && ctx.redis) {
          // Release the burn so a retry after a DB hiccup is not blocked.
          // Keep the token lookup keys so the user can click the email link again.
          await unburnSignupToken(ctx.redis, event.payload.token);
        }
      }
    },
  });
}
