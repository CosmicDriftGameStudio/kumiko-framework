// Address lookup across the tenant's mailboxes. Addresses are ciphertext in the projection, so the
// comparison happens in memory after decrypting (a tenant has a handful of mailboxes).

import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { InboundMailAccountStatuses, InboundMailAuthMethods } from "../constants.ts";
import { MAIL_ACCOUNT_PII_FIELDS } from "../entities.ts";
import { mailAccountsProjectionTable } from "../projection.ts";

export type AddressMatch = {
  readonly id: string;
  readonly provider: string;
  readonly authMethod: string;
  readonly ownerUserId: string | null;
  readonly status: string;
};

export function normalizeMailAddress(address: string): string {
  return address.trim().toLowerCase();
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// A live mailbox wins over a disconnected one: connecting next to a live mailbox is always a duplicate.
export async function findMailboxByAddress(
  ctx: Pick<HandlerContext, "db">,
  tenantId: string,
  address: string,
): Promise<AddressMatch | undefined> {
  const wanted = normalizeMailAddress(address);
  const rows = await ctx.db.selectMany(mailAccountsProjectionTable, { tenantId });
  const piiKms = configuredPiiSubjectKms();
  const matches: AddressMatch[] = [];
  for (const row of rows) {
    const readable = piiKms
      ? await decryptPiiFieldValues(row, MAIL_ACCOUNT_PII_FIELDS, piiKms, {
          requestId: `inbound-mail-foundation:connect-account:${tenantId}`,
        })
      : row;
    if (normalizeMailAddress(textOf(readable["address"])) !== wanted) continue;
    matches.push({
      id: textOf(row["id"]),
      provider: textOf(row["provider"]),
      authMethod: textOf(row["authMethod"]),
      ownerUserId: typeof row["ownerUserId"] === "string" ? row["ownerUserId"] : null,
      status: textOf(row["status"]),
    });
  }
  return matches.find((m) => m.status !== InboundMailAccountStatuses.disconnected) ?? matches[0];
}

export type ConnectConflict = "already_connected" | "address_disconnected" | "reopen_in_place";

// A disconnected or sign-in-failed OAuth mailbox of the same provider and owner is reopened (the
// callback writes the new token into the same slot); everything else must not silently create a second stream for one address.
export function connectConflictOf(
  existing: AddressMatch,
  wanted: {
    readonly authMethod: string;
    readonly provider: string;
    readonly ownerUserId: string | null;
  },
): ConnectConflict {
  const disconnected = existing.status === InboundMailAccountStatuses.disconnected;
  // A sign-in error of an OAuth mailbox is healed by signing in again, so it reopens like a disconnect.
  const signInFailed = existing.status === InboundMailAccountStatuses.authError;
  if (!disconnected && !signInFailed) return "already_connected";
  const bothOauth =
    wanted.authMethod === InboundMailAuthMethods.oauth &&
    existing.authMethod === InboundMailAuthMethods.oauth &&
    existing.provider === wanted.provider;
  if (!bothOauth) return disconnected ? "address_disconnected" : "already_connected";
  return existing.ownerUserId === wanted.ownerUserId ? "reopen_in_place" : "already_connected";
}
