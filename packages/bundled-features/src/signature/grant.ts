import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  parseTenantScopedSubject,
  peekTenantScopedSubject,
  type RowBoundGrantResult,
  redeemRowBoundGrant,
  signRowBoundGrant,
  tenantScopedSubject,
} from "../shared/index.ts";
import { SIGNATURE_LINK_TTL_DAYS } from "./web/constants.ts";

type AnchorCommit = Parameters<typeof redeemRowBoundGrant>[0]["commitAnchor"];

const SIGNATURE_LINK_PURPOSE = "signature-link";
const MINUTES_PER_DAY = 24 * 60;

export type SignatureLinkSubject = { readonly tenantId: TenantId; readonly signerId: string };

export function signatureLinkSubject(parts: {
  readonly tenantId: string;
  readonly signerId: string;
}): string {
  return tenantScopedSubject({ tenantId: parts.tenantId, rowId: parts.signerId });
}

function toSignatureLinkSubject(
  scoped: ReturnType<typeof parseTenantScopedSubject>,
): SignatureLinkSubject | null {
  return scoped === null ? null : { tenantId: scoped.tenantId, signerId: scoped.rowId };
}

export function parseSignatureLinkSubject(subject: string): SignatureLinkSubject | null {
  return toSignatureLinkSubject(parseTenantScopedSubject(subject));
}

export function peekSignatureLinkSubject(token: string): SignatureLinkSubject | null {
  return toSignatureLinkSubject(peekTenantScopedSubject(token));
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
