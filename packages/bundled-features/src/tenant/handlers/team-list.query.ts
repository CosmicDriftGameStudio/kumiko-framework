import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  access,
  definePagedQueryHandler,
  MAX_LIST_LIMIT,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { userSessionTable } from "../../sessions";
import { decryptStoredPii, mapWithConcurrency } from "../../shared";
import { userTable } from "../../user";
import { INVITATION_STATUS, tenantInvitationsTable } from "../invitation-table";
import { tenantMembershipsTable } from "../membership-table";

const KMS_POOL_CONCURRENCY = 4;

type TeamStatus = "active" | "pending";

type TeamRow = {
  readonly id: string;
  readonly userId: string | null;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly roles: readonly string[];
  readonly status: TeamStatus;
  readonly createdAt: Temporal.Instant;
  readonly lastSeenAt: Temporal.Instant | null;
  readonly expiresAt: Temporal.Instant | null;
};

// The /members screen exposes one column per field above under the SAME
// name — unlike delivery-log there is no display-alias to map, `sort` on
// the wire already names a TeamRow field directly.
const SORT_FIELDS = ["email", "status", "createdAt", "lastSeenAt"] as const;
type SortField = (typeof SORT_FIELDS)[number];

function isSortField(value: string): value is SortField {
  return (SORT_FIELDS as readonly string[]).includes(value);
}

// Nulls (no session yet, invitation rows) sort last regardless of
// direction — "unknown" reads as "least recent", not as a magic minimum
// that flips to the top on `desc`.
function compareTeamRows(a: TeamRow, b: TeamRow, field: SortField, dir: "asc" | "desc"): number {
  const sign = dir === "asc" ? 1 : -1;
  if (field === "createdAt") return Temporal.Instant.compare(a.createdAt, b.createdAt) * sign;
  if (field === "lastSeenAt") {
    if (a.lastSeenAt === null && b.lastSeenAt === null) return 0;
    if (a.lastSeenAt === null) return 1;
    if (b.lastSeenAt === null) return -1;
    return Temporal.Instant.compare(a.lastSeenAt, b.lastSeenAt) * sign;
  }
  const av = field === "email" ? (a.email ?? "") : a.status;
  const bv = field === "email" ? (b.email ?? "") : b.status;
  return av.localeCompare(bv) * sign;
}

// User-selected facet filters (payload.filters, fw#2224) — `status` is the
// only filterable field here: it's synthesized from which table a row came
// from, not a stored column, so there is nothing else meaningful to filter
// on server-side yet. `filter` (singular, screen-level static filter) is
// accepted for schema-shape parity but unused — no /members screen sets one.
function matchesStatusFilter(
  row: TeamRow,
  filters: readonly { field: string; value: unknown }[],
): boolean {
  const statusFilter = filters.find((f) => f.field === "status");
  if (statusFilter === undefined) return true;
  const allowed = Array.isArray(statusFilter.value) ? statusFilter.value : [statusFilter.value];
  return allowed.includes(row.status);
}

export const teamListQuery = definePagedQueryHandler({
  name: "team:list",
  schema: z.object({
    limit: z.number().int().min(1).max(MAX_LIST_LIMIT).default(50),
    offset: z.number().int().nonnegative().optional(),
    sort: z.string().optional(),
    sortDirection: z.enum(["asc", "desc"]).optional(),
    search: z.string().optional(),
    totalCount: z.boolean().optional(),
    filter: z
      .object({
        field: z.string(),
        op: z.enum(["eq", "ne", "lt", "gt", "in"]),
        value: z.unknown(),
      })
      .optional(),
    filters: z
      .array(
        z.object({
          field: z.string(),
          op: z.enum(["eq", "ne", "lt", "gt", "in"]),
          value: z.unknown(),
        }),
      )
      .optional(),
  }),
  access: { roles: access.admin },
  handler: async (query, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "tenant:query:team:list requires ctx.systemDb — is r.systemScope() still set on the tenant feature?",
      });
    }
    const db = ctx.systemDb.assertTenantMatch(query.user.tenantId);
    const tenantId = query.user.tenantId;

    const membershipRows = await selectMany(db, tenantMembershipsTable, { tenantId });
    const userIds = [...new Set(membershipRows.map((row) => String(row["userId"])))];
    const users =
      userIds.length > 0
        ? await selectMany<{ id: unknown; email?: unknown; displayName?: unknown }>(db, userTable, {
            id: userIds,
          })
        : [];

    const lastSeenByUserId = new Map<string, Temporal.Instant>();
    if (userIds.length > 0) {
      try {
        const sessions = await selectMany<{ userId: unknown; lastSeenAt: unknown }>(
          db,
          userSessionTable,
          { tenantId, userId: userIds },
        );
        for (const session of sessions) {
          const value = session["lastSeenAt"];
          if (!(value instanceof Temporal.Instant)) continue;
          const userId = String(session["userId"]);
          const current = lastSeenByUserId.get(userId);
          if (current === undefined || Temporal.Instant.compare(value, current) > 0) {
            lastSeenByUserId.set(userId, value);
          }
        }
      } catch (err) {
        // ponytail: lean sample apps (admin-console) mount auth without
        // sessions — store_user_sessions never gets pushed. Integration tests
        // may seed the table without mounting the feature; prod mounts both.
        if ((err as { code?: string }).code !== "42P01") throw err;
      }
    }

    // Bounded, not Promise.all/sequential-per-item: shares the KMS
    // adapter's small dedicated pool (max 4, see members.query.ts) with the
    // invitations decrypt below — the two passes run one after the other
    // (await, not Promise.all), so combined concurrency never exceeds 4.
    const decryptedUsers = await mapWithConcurrency(users, KMS_POOL_CONCURRENCY, async (user) => {
      const email =
        typeof user.email === "string"
          ? await decryptStoredPii(user.email, "email", "tenant:team-list")
          : null;
      const displayName =
        typeof user.displayName === "string"
          ? await decryptStoredPii(user.displayName, "displayName", "tenant:team-list")
          : null;
      return { userId: String(user.id), email, displayName };
    });
    const decryptedByUserId = new Map(decryptedUsers.map((d) => [d.userId, d]));

    const memberRows: TeamRow[] = membershipRows.map((row) => {
      const userId = String(row["userId"]);
      const decrypted = decryptedByUserId.get(userId);
      const createdAt = row["createdAt"];
      return {
        id: String(row["id"]),
        userId,
        email: decrypted?.email ?? null,
        displayName: decrypted?.displayName ?? null,
        roles: parseRoles(row["roles"]),
        status: "active",
        createdAt: createdAt instanceof Temporal.Instant ? createdAt : Temporal.Now.instant(),
        lastSeenAt: lastSeenByUserId.get(userId) ?? null,
        expiresAt: null,
      };
    });

    // Pending only — accepted/cancelled/expired invitations don't belong on
    // this screen (accepted ones already surfaced as a membership row above;
    // the rest is history for a separate audit feature). SQL-side filter,
    // same rationale as invitations.query.ts.
    const pendingInvitations = await selectMany<Record<string, unknown>>(
      db,
      tenantInvitationsTable,
      { tenantId, status: INVITATION_STATUS.pending },
    );
    const invitationRows: TeamRow[] = await mapWithConcurrency(
      pendingInvitations,
      KMS_POOL_CONCURRENCY,
      async (row): Promise<TeamRow> => {
        const email = row["email"];
        const decryptedEmail =
          typeof email === "string"
            ? await decryptStoredPii(email, "email", "tenant:team-list")
            : null;
        const createdAt = row["createdAt"];
        const expiresAt = row["expiresAt"];
        return {
          id: String(row["id"]),
          userId: null,
          email: decryptedEmail,
          displayName: null,
          roles: typeof row["role"] === "string" ? [row["role"]] : [],
          status: "pending",
          createdAt: createdAt instanceof Temporal.Instant ? createdAt : Temporal.Now.instant(),
          lastSeenAt: null,
          expiresAt: expiresAt instanceof Temporal.Instant ? expiresAt : null,
        };
      },
    );

    // Merge → filter → sort → slice, in that order: `total` and the page
    // window both have to be computed against the FILTERED set, not the raw
    // merge, or the pager and the status-facet disagree with each other.
    //
    // ponytail: reads both tables fully and merges/sorts/slices in JS —
    // there is no cursor. A cursor over a list merged from two tables in
    // application code is either wrong (each source paginates
    // independently, so page boundaries don't line up) or has to read
    // everything anyway to know where the boundary falls. This holds up to
    // the order of a few thousand members per tenant; past that the fix is
    // a real combined read-projection (a materialized view/table kept in
    // sync by both tenant-membership and tenant-invitation events), not a
    // cursor bolted onto this merge.
    const search = query.payload.search?.trim().toLowerCase();
    const merged = [...memberRows, ...invitationRows].filter((row) => {
      if (search === undefined || search === "") return true;
      return (
        (row.email?.toLowerCase().includes(search) ?? false) ||
        (row.displayName?.toLowerCase().includes(search) ?? false)
      );
    });
    const filtered = merged.filter((row) => matchesStatusFilter(row, query.payload.filters ?? []));

    const requestedSort = query.payload.sort;
    const sortField: SortField =
      requestedSort !== undefined && isSortField(requestedSort) ? requestedSort : "createdAt";
    const sortDirection = query.payload.sortDirection ?? "desc";
    const sorted = [...filtered].sort((a, b) => compareTeamRows(a, b, sortField, sortDirection));

    const offset = query.payload.offset ?? 0;
    const limit = query.payload.limit;
    const page = sorted.slice(offset, offset + limit);

    return {
      rows: page,
      nextCursor: null,
      ...(query.payload.totalCount === true && { total: filtered.length }),
    };
  },
});
