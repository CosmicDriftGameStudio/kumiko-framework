import {
  createTenantDb,
  entityEventName,
  fetchOne,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import { type MultiStreamApplyFn, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { decryptStoredPii } from "../shared/index.ts";
import { tenantMembershipsTable } from "../tenant/index.ts";
import { userTable } from "../user/index.ts";
import { DEFAULT_OWN_TENANT_INVITE_ROLE, WAITLIST_STATUS } from "./constants.ts";
import { normalizeEmail, platformActor, waitlistExecutor } from "./lib.ts";

const PII_DECRYPT_REASON = "waitlist:link-on-signup";

export const WAITLIST_MEMBERSHIP_CREATED_EVENT = entityEventName("tenant-membership", "created");

type SignupOwnerMembership = { readonly userId: string; readonly tenantId: string };

// Only a TenantAdmin membership can be the signup owner; invite-accept memberships of
// other roles are not owners.
function readSignupOwnerMembership(
  event: Parameters<MultiStreamApplyFn>[0],
): SignupOwnerMembership | undefined {
  const { userId, roles } = event.payload;
  if (typeof userId !== "string") return undefined;
  if (!parseRoles(roles).includes(DEFAULT_OWN_TENANT_INVITE_ROLE)) return undefined;
  return { userId, tenantId: event.tenantId };
}

// An unreadable submittedAt sorts last instead of throwing: one bad row must not
// stall the at-least-once consumer.
function newestSubmittedFirst(a: Record<string, unknown>, b: Record<string, unknown>): number {
  return submittedAtMillis(b) - submittedAtMillis(a);
}

function submittedAtMillis(row: Record<string, unknown>): number {
  return instantMillis(row["submittedAt"]);
}

function instantMillis(value: unknown): number {
  if (value instanceof Temporal.Instant) return value.epochMilliseconds;
  if (typeof value !== "string") return 0;
  try {
    return Temporal.Instant.from(value).epochMilliseconds;
  } catch {
    // Temporal.Instant.from throws RangeError for a non-ISO string.
    return 0;
  }
}

// Runs as a multi-stream consumer (at least once): the hook phase of the signup and
// invite-accept paths has no system db handle, and a waitlist problem must not roll
// back the signup. Idempotent because only `invited` entries are updated.
export const linkWaitlistOnSignup: MultiStreamApplyFn = async (event, tx) => {
  const membership = readSignupOwnerMembership(event);
  // skip: not a TenantAdmin membership, nothing to link.
  if (!membership) return;

  // Only the tenant's first membership is the owner; later TenantAdmin invites must not link.
  const [first] = await selectMany<{ readonly id: string }>(
    tx,
    tenantMembershipsTable,
    { tenantId: membership.tenantId },
    { limit: 1, fields: ["id"], orderBy: [{ col: "insertedAt" }, { col: "id" }] },
  );
  // skip: another membership came first.
  if (first && first.id !== event.aggregateId) return;

  const db = createTenantDb({ db: tx, tenantId: SYSTEM_TENANT_ID, mode: "system" });
  const user = await fetchOne<{ email?: unknown }>(tx, userTable, { id: membership.userId });
  // skip: user row unreadable (erased or not projected yet).
  if (typeof user?.email !== "string") return;
  const email = normalizeEmail(await decryptStoredPii(user.email, "email", PII_DECRYPT_REASON));

  const found = await waitlistExecutor.list(
    {
      filter: { field: "email", op: "eq", value: email },
      filters: [{ field: "status", op: "in", value: [WAITLIST_STATUS.Invited] }],
    },
    platformActor(),
    db,
  );
  const invited = [...found.rows].sort(newestSubmittedFirst)[0];
  // skip: the signup email has no invited waitlist entry (open signup or stale invite).
  if (!invited) return;
  const { id, version } = invited;
  // skip: defensive guard on the row shape.
  if (typeof id !== "string" || typeof version !== "number") return;

  await waitlistExecutor.update(
    {
      id,
      version,
      changes: {
        status: WAITLIST_STATUS.Provisioned,
        linkedTenantId: membership.tenantId,
        provisionedAt: Temporal.Now.instant(),
      },
    },
    platformActor(),
    db,
  );
};
