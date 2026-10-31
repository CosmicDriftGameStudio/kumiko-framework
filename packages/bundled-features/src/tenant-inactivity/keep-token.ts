import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  type RowBoundGrantResult,
  redeemRowBoundGrant,
  signRowBoundGrant,
} from "../shared/index.ts";

const KEEP_ACCOUNT_PURPOSE = "keep-account";

// Subject is the tenant, anchor the state row's cycleId: any activity or a redeemed link rotates
// the cycleId, so every earlier link stops verifying.
export function signKeepAccountToken(args: {
  readonly tenantId: string;
  readonly cycleId: string;
  readonly ttlMinutes: number;
  readonly secret: string;
  readonly now: Temporal.Instant;
}): string {
  return signRowBoundGrant({
    subject: args.tenantId,
    purpose: KEEP_ACCOUNT_PURPOSE,
    anchor: args.cycleId,
    ttlMinutes: args.ttlMinutes,
    secret: args.secret,
    now: args.now,
  }).token;
}

export function redeemKeepAccountToken(args: {
  readonly token: string;
  readonly secret: string | undefined;
  readonly loadCycleId: (tenantId: string) => Promise<string | null>;
  readonly commitKeep: (tenantId: string, cycleId: string) => Promise<boolean>;
  readonly now: Temporal.Instant;
}): Promise<RowBoundGrantResult> {
  return redeemRowBoundGrant({
    token: args.token,
    purpose: KEEP_ACCOUNT_PURPOSE,
    secret: args.secret,
    loadAnchor: args.loadCycleId,
    commitAnchor: args.commitKeep,
    now: args.now,
  });
}
