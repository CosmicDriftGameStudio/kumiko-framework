import { isUuid, parseTenantId, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  peekTokenSubject,
  type RowBoundGrantResult,
  redeemRowBoundGrant,
  signRowBoundGrant,
} from "../shared/index.ts";
import { SIGNATURE_LINK_TTL_DAYS } from "./web/constants.ts";

type AnchorCommit = Parameters<typeof redeemRowBoundGrant>[0]["commitAnchor"];

const SIGNATURE_LINK_PURPOSE = "signature-link";
const MINUTES_PER_DAY = 24 * 60;

// Signers live in the tenant of the request, but the anonymous link holder arrives in the default
// tenant. The tenant therefore travels in the (signed) subject; "_" cannot appear in a UUID and the
// subject must stay free of ":" and ".".
export type SignatureLinkSubject = { readonly tenantId: TenantId; readonly signerId: string };

export function signatureLinkSubject(parts: {
  readonly tenantId: string;
  readonly signerId: string;
}): string {
  return `${parts.tenantId}_${parts.signerId}`;
}

export function parseSignatureLinkSubject(subject: string): SignatureLinkSubject | null {
  const [rawTenantId, signerId, ...rest] = subject.split("_");
  const tenantId = parseTenantId(rawTenantId);
  if (rest.length > 0 || tenantId === null || !isUuid(signerId)) return null;
  return { tenantId, signerId };
}

// Reads the unverified subject only to pick the tenant to dispatch into; the grant is still
// verified against the signer's current anchor there.
export function peekSignatureLinkSubject(token: string): SignatureLinkSubject | null {
  const subject = peekTokenSubject(token);
  return subject === null ? null : parseSignatureLinkSubject(subject);
}

export function signSignatureLinkToken(args: {
  readonly tenantId: string;
  readonly signerId: string;
  readonly linkAnchor: string;
  readonly secret: string;
  readonly now: Temporal.Instant;
}): { readonly token: string; readonly expiresAt: Temporal.Instant } {
  return signRowBoundGrant({
    subject: signatureLinkSubject(args),
    purpose: SIGNATURE_LINK_PURPOSE,
    anchor: args.linkAnchor,
    ttlMinutes: SIGNATURE_LINK_TTL_DAYS * MINUTES_PER_DAY,
    secret: args.secret,
    now: args.now,
  });
}

export function redeemSignatureLinkToken(args: {
  readonly token: string;
  readonly secret: string;
  readonly now: Temporal.Instant;
  readonly loadLinkAnchor: (signerId: string) => Promise<string | null>;
  readonly commitAnchor: AnchorCommit;
}): Promise<RowBoundGrantResult> {
  return redeemRowBoundGrant({
    token: args.token,
    purpose: SIGNATURE_LINK_PURPOSE,
    secret: args.secret,
    now: args.now,
    commitAnchor: args.commitAnchor,
    loadAnchor: (subject) => {
      const parsed = parseSignatureLinkSubject(subject);
      return parsed === null ? Promise.resolve(null) : args.loadLinkAnchor(parsed.signerId);
    },
  });
}

export type { RowBoundGrantResult };
