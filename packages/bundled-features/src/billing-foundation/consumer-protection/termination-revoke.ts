// "This cancellation was not me": the signed link in the receipt mail of a
// matched public declaration takes the cancellation back until it takes effect.
// The anonymous handler only routes to the declaration's tenant; the system
// handler checks the token and does the work.

import { createHash, timingSafeEqual } from "node:crypto";
import {
  access,
  createSystemUser,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { subscriptionAggregateId } from "../aggregate-id.ts";
import { SubscriptionFoundationHandlers } from "../constants.ts";
import {
  CONTRACT_TERMINATION_DECLARED_EVENT_QN,
  CONTRACT_TERMINATION_REQUESTED_EVENT_QN,
  CONTRACT_TERMINATION_REVOKED_EVENT_QN,
  type ContractTerminationRevokedPayload,
  contractTerminationDeclaredPayloadSchema,
  contractTerminationRequestedPayloadSchema,
  SUBSCRIPTION_AGGREGATE_TYPE,
} from "../events.ts";
import { getSubscriptionForTenant } from "../get-subscription-for-tenant.ts";
import type { ConsumerProtectionOptions, ResolvedBillingFoundationOptions } from "../types.ts";
import type { ConsentLocale } from "./consent-text.ts";
import { notifyOperator } from "./termination-notify.ts";
import { hasRevocation, resumeAtProvider } from "./termination-record.ts";
import type { OperatorNoticeReason } from "./termination-texts.ts";

export const REVOCATION_PATHS: Readonly<Record<ConsentLocale, string>> = {
  de: "/legal/kuendigen/zuruecknehmen",
  en: "/legal/cancel/revoke",
};

const TOKEN_BYTES = 32;

export type RevocationOutcome = "revoked" | "already-revoked" | "too-late" | "invalid";

export function createRevocationToken(): { readonly token: string; readonly tokenHash: string } {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))).toString(
    "base64url",
  );
  return { token, tokenHash: hashRevocationToken(token) };
}

function hashRevocationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokenMatchesHash(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashRevocationToken(token));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function revocationUrl(args: {
  readonly baseUrl: string;
  readonly locale: ConsentLocale;
  readonly requestId: string;
  readonly token: string;
  readonly tenantId: string;
}): string {
  // Origin only: a baseUrl path prefix would not match the routes mounted at the root.
  const url = new URL(REVOCATION_PATHS[args.locale], new URL(args.baseUrl).origin);
  url.searchParams.set("r", args.requestId);
  url.searchParams.set("t", args.token);
  url.searchParams.set("tenant", args.tenantId);
  return url.toString();
}

const revocationFieldsSchema = {
  requestId: z.string().min(1).max(100),
  token: z.string().min(1).max(200),
};

export const revokeContractTerminationSchema = z
  .object({ ...revocationFieldsSchema, tenantId: z.uuid() })
  .strict();

export const recordContractTerminationRevocationSchema = z.object(revocationFieldsSchema).strict();

function parseOutcome(data: unknown): RevocationOutcome {
  const parsed = z
    .object({ outcome: z.enum(["revoked", "already-revoked", "too-late", "invalid"]) })
    .safeParse(data);
  return parsed.success ? parsed.data.outcome : "invalid";
}

export function createRevokeContractTerminationHandler(): WriteHandlerDef {
  return {
    name: "revoke-contract-termination",
    description:
      'Public "this was not me" link of the § 312k receipt mail: takes a public cancellation back until it takes effect; an unknown request and a wrong token answer the same.',
    schema: revokeContractTerminationSchema,
    access: { roles: ["anonymous"] },
    rateLimit: { per: "ip+handler", limit: 5, windowSeconds: 600 },
    tenantlessAnonymous: true,
    escapeHatch: {
      reason:
        "Anonymous revoker has no session — the declaration is looked up as a system user of the tenant named in the link; the token check decides, and the tenant written to comes only from that lookup.",
    },
    handler: async (event, ctx) => {
      // @cast-boundary engine-payload — dispatcher-zod-validated payload
      const payload = event.payload as z.infer<typeof revokeContractTerminationSchema>;
      const result = await ctx.writeAs(
        createSystemUser(payload.tenantId),
        SubscriptionFoundationHandlers.recordContractTerminationRevocation,
        { requestId: payload.requestId, token: payload.token },
      );
      return {
        isSuccess: true as const,
        data: { outcome: result.isSuccess ? parseOutcome(result.data) : "invalid" },
      };
    },
  };
}

export function createRecordContractTerminationRevocationHandler(
  options: ResolvedBillingFoundationOptions,
  consumerProtection: ConsumerProtectionOptions,
): WriteHandlerDef {
  return {
    name: "record-contract-termination-revocation",
    agent: { expose: false },
    schema: recordContractTerminationRevocationSchema,
    access: { roles: access.system },
    handler: async (event, ctx) => {
      // @cast-boundary engine-payload — dispatcher-zod-validated payload
      const payload = event.payload as z.infer<typeof recordContractTerminationRevocationSchema>;
      const tenantId = event.user.tenantId;
      const outcome = (value: RevocationOutcome) => ({
        isSuccess: true as const,
        data: { outcome: value },
      });
      const stream = await ctx.fetchForWriting({
        aggregateId: subscriptionAggregateId(tenantId),
        aggregateType: SUBSCRIPTION_AGGREGATE_TYPE,
      });

      const declared = stream.events
        .filter((e) => e.type === CONTRACT_TERMINATION_DECLARED_EVENT_QN)
        .map((e) => contractTerminationDeclaredPayloadSchema.safeParse(e.payload).data)
        .find((candidate) => candidate?.requestId === payload.requestId);
      if (
        declared?.revocationTokenHash === undefined ||
        !tokenMatchesHash(payload.token, declared.revocationTokenHash)
      ) {
        return outcome("invalid");
      }
      if (hasRevocation(stream.events, payload.requestId)) return outcome("already-revoked");

      const requested = stream.events
        .filter((e) => e.type === CONTRACT_TERMINATION_REQUESTED_EVENT_QN)
        .map((e) => contractTerminationRequestedPayloadSchema.safeParse(e.payload).data)
        .find((candidate) => candidate?.requestId === payload.requestId);
      const subscription = await getSubscriptionForTenant(ctx, tenantId);
      const effectiveAtIso = requested?.effectiveAtIso ?? subscription?.currentPeriodEnd.toString();
      const now = options.now();
      if (
        effectiveAtIso !== undefined &&
        Temporal.Instant.compare(now, Temporal.Instant.from(effectiveAtIso)) >= 0
      ) {
        return outcome("too-late");
      }

      const reasons: OperatorNoticeReason[] = ["revoked"];
      if (requested?.providerCancel === "period-end") {
        reasons.push(...(await resumeAtProvider(ctx, subscription)));
      }
      // Re-fetch after the external call, like record-contract-termination.
      const streamAfterProviderCall = await ctx.fetchForWriting({
        aggregateId: subscriptionAggregateId(tenantId),
        aggregateType: SUBSCRIPTION_AGGREGATE_TYPE,
      });
      const revoked: ContractTerminationRevokedPayload = {
        requestId: payload.requestId,
        revokedAtIso: now.toString(),
      };
      await streamAfterProviderCall.appendOne({
        type: CONTRACT_TERMINATION_REVOKED_EVENT_QN,
        payload: revoked,
      });
      await notifyOperator(ctx, consumerProtection, {
        locale: declared.locale,
        requestId: declared.requestId,
        receivedAtIso: declared.receivedAtIso,
        channel: "public",
        declaration: {
          declarationType: declared.declarationType,
          terminationKind: declared.terminationKind,
        },
        reasons,
        tenantId,
        ...(requested !== undefined && { providerCancel: requested.providerCancel }),
      });
      return outcome("revoked");
    },
  };
}
