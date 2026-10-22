import { createHash } from "node:crypto";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { normalizeEmail, platformActor, waitlistExecutor } from "./lib.ts";
import { WAITLIST_FIELD_LIMITS, type WaitlistStatus } from "./web/constants.ts";

export type WaitlistImportEntry = {
  /** Stable identity of the source row (e.g. `offlot:<uuid>`); the new entry id derives from it. */
  readonly sourceKey: string;
  readonly name: string;
  readonly email: string;
  readonly locale: string;
  readonly status: WaitlistStatus;
  readonly submittedAt: Temporal.Instant;
  readonly company?: string;
  readonly portfolio?: string;
  readonly message?: string;
  readonly invitedAt?: Temporal.Instant;
  readonly invitedBy?: string;
  readonly provisionedAt?: Temporal.Instant;
  readonly linkedTenantId?: string;
};

export type WaitlistImportOutcome = "created" | "skipped";

// RFC 4122 name-based UUID (v5 layout, fixed namespace) so a re-run finds the entry
// it created before without matching on encrypted personal data.
const IMPORT_NAMESPACE = "kumiko-waitlist-import";

export function waitlistImportId(sourceKey: string): string {
  const bytes = createHash("sha1").update(`${IMPORT_NAMESPACE}:${sourceKey}`).digest();
  const byte6 = bytes[6] ?? 0;
  const byte8 = bytes[8] ?? 0;
  bytes[6] = (byte6 & 0x0f) | 0x50;
  bytes[8] = (byte8 & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// The version nibble marks ids minted by waitlistImportId; legacy row ids are random UUIDs.
export function isWaitlistImportId(id: string): boolean {
  return id[14] === "5";
}

// The live submit schema caps these fields; an imported value above the cap would be
// stored but could never pass a later update through the same payload schema.
export function waitlistImportEntryWithinLimits(entry: WaitlistImportEntry): boolean {
  const limited: ReadonlyArray<readonly [string | undefined, number]> = [
    [entry.name, WAITLIST_FIELD_LIMITS.name],
    [entry.email, WAITLIST_FIELD_LIMITS.email],
    [entry.locale, WAITLIST_FIELD_LIMITS.locale],
    [entry.company, WAITLIST_FIELD_LIMITS.company],
    [entry.portfolio, WAITLIST_FIELD_LIMITS.portfolio],
    [entry.message, WAITLIST_FIELD_LIMITS.message],
  ];
  return limited.every(([value, max]) => value === undefined || value.length <= max);
}

function presentOnly(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

// Writes through the entity executor, so events and projection match a live submit; subject
// encryption applies only when the caller configured a PII KMS (the CLI wires it from env
// and aborts without one). No mail, no rate limit, no duplicate-by-email
// check: the source row is the truth and the id makes the call idempotent.
export async function importWaitlistEntry(
  db: TenantDb,
  entry: WaitlistImportEntry,
  options: { readonly dryRun?: boolean } = {},
): Promise<WaitlistImportOutcome> {
  if (!waitlistImportEntryWithinLimits(entry)) {
    throw new InternalError({
      message: `waitlist import entry ${entry.sourceKey} exceeds a field length limit`,
    });
  }
  const id = waitlistImportId(entry.sourceKey);
  const existing = await waitlistExecutor.detail({ id }, platformActor(), db);
  if (existing) return "skipped";
  if (options.dryRun === true) return "created";
  const created = await waitlistExecutor.create(
    {
      id,
      name: entry.name,
      email: normalizeEmail(entry.email),
      locale: entry.locale,
      status: entry.status,
      submittedAt: entry.submittedAt,
      ...presentOnly({
        company: entry.company,
        portfolio: entry.portfolio,
        message: entry.message,
        invitedAt: entry.invitedAt,
        invitedBy: entry.invitedBy,
        provisionedAt: entry.provisionedAt,
        linkedTenantId: entry.linkedTenantId,
      }),
    },
    platformActor(),
    db,
  );
  if (!created.isSuccess)
    throw new InternalError({
      message: `waitlist import failed for ${entry.sourceKey}: ${created.error.code}`,
    });
  return "created";
}
