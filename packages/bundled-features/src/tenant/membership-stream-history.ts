// Membership lifecycle as the event log tells it, keyed by the (userId, tenantId) pair of each
// stream's created event. The projection's unique index allows one live row per pair, so a replay
// fails as soon as a second stream of a pair is created while another one is alive. Such streams
// came from seeds that only consulted the projection after its rows were lost.

import {
  type DbRunner,
  entityEventName,
  toPostgresArrayLiteral,
  unsafeReadRetrying,
} from "@cosmicdrift/kumiko-framework/db";
import { parseTenantId } from "@cosmicdrift/kumiko-framework/engine";
import { archiveStream } from "@cosmicdrift/kumiko-framework/event-store";

const MEMBERSHIP_AGGREGATE = "tenant-membership";
const USER_AGGREGATE = "user";
const CREATED = entityEventName(MEMBERSHIP_AGGREGATE, "created");
const ROW_REMOVING_TYPES = [
  entityEventName(MEMBERSHIP_AGGREGATE, "deleted"),
  entityEventName(MEMBERSHIP_AGGREGATE, "forgotten"),
];
const LIFECYCLE_TYPES = [
  CREATED,
  entityEventName(MEMBERSHIP_AGGREGATE, "updated"),
  ...ROW_REMOVING_TYPES,
];
const ARCHIVED_BY = "stream-tenant-backfill";

type MembershipEventRow = {
  readonly event_id: string;
  readonly aggregate_id: string;
  readonly stream_tenant_id: string;
  readonly type: string;
  readonly user_id: string;
  readonly member_tenant_id: string;
  readonly user_archived: boolean;
};

type MembershipStream = {
  readonly aggregateId: string;
  readonly streamTenantIds: Set<string>;
  readonly userArchived: boolean;
  lastEventId: bigint;
  alive: boolean;
};

export type ArchivedMembershipStream = {
  readonly aggregateId: string;
  readonly reason: "user_archived" | "duplicate";
  // The stream of the same pair that stays; set for duplicates.
  readonly keptAggregateId?: string;
};

// Archived streams are left out: they do not replay and cannot be written to.
async function readMembershipEvents(
  db: DbRunner,
  pair?: { readonly userId: string; readonly tenantId: string },
): Promise<readonly MembershipEventRow[]> {
  const params: unknown[] = [
    MEMBERSHIP_AGGREGATE,
    CREATED,
    toPostgresArrayLiteral(LIFECYCLE_TYPES),
    USER_AGGREGATE,
  ];
  let pairSql = "";
  if (pair) {
    params.push(pair.tenantId, pair.userId);
    // Only created events carry the pair; later events of the stream are matched by aggregate.
    // The aggregate type is inlined so the planner can use the partial index
    // events_membership_payload_tenant_idx under a generic plan as well.
    pairSql = ` AND e."aggregate_id" IN (
         SELECT p."aggregate_id" FROM "kumiko_events" p
          WHERE p."aggregate_type" = '${MEMBERSHIP_AGGREGATE}' AND p."type" = $2
            AND p."payload"->>'tenantId' = $5 AND p."payload"->>'userId' = $6)`;
  }
  return unsafeReadRetrying<MembershipEventRow>(
    db,
    // A user counts as archived only while none of its events sits outside an archived stream.
    `WITH archived_users AS (
       SELECT DISTINCT u."aggregate_id"::text AS aggregate_id FROM "kumiko_archived_streams" u
        WHERE u."aggregate_type" = $4
          AND NOT EXISTS (
            SELECT 1 FROM "kumiko_events" ue
             WHERE ue."aggregate_id" = u."aggregate_id" AND ue."aggregate_type" = $4
               AND NOT EXISTS (SELECT 1 FROM "kumiko_archived_streams" ua
                                WHERE ua."tenant_id" = ue."tenant_id" AND ua."aggregate_id" = ue."aggregate_id"))
     )
     SELECT e."id"::text AS event_id, e."aggregate_id"::text AS aggregate_id,
            e."tenant_id"::text AS stream_tenant_id, e."type" AS type,
            c."user_id" AS user_id, c."member_tenant_id" AS member_tenant_id,
            c."user_id" IN (SELECT aggregate_id FROM archived_users) AS user_archived
       FROM "kumiko_events" e
       JOIN LATERAL (
         SELECT f."payload"->>'userId' AS user_id, f."payload"->>'tenantId' AS member_tenant_id
           FROM "kumiko_events" f
          WHERE f."aggregate_id" = e."aggregate_id" AND f."aggregate_type" = $1 AND f."type" = $2
          ORDER BY f."id" ASC LIMIT 1
       ) c ON c."user_id" IS NOT NULL AND c."member_tenant_id" IS NOT NULL
      WHERE e."aggregate_type" = $1 AND e."type" = ANY($3::text[])${pairSql}
        AND NOT EXISTS (SELECT 1 FROM "kumiko_archived_streams" a
                         WHERE a."tenant_id" = e."tenant_id" AND a."aggregate_id" = e."aggregate_id")
      ORDER BY e."id" ASC`,
    params,
  );
}

type PairHistory = {
  readonly streams: Map<string, MembershipStream>;
  // A created event arrived while another stream of the pair was alive: replay collides.
  collides: boolean;
};

function pairKeyOf(row: MembershipEventRow): string {
  return `${row.user_id}\u0000${row.member_tenant_id}`;
}

function groupByPair(rows: readonly MembershipEventRow[]): Map<string, PairHistory> {
  const pairs = new Map<string, PairHistory>();
  for (const row of rows) {
    const key = pairKeyOf(row);
    const pair = pairs.get(key) ?? { streams: new Map(), collides: false };
    pairs.set(key, pair);
    let stream = pair.streams.get(row.aggregate_id);
    if (!stream) {
      stream = {
        aggregateId: row.aggregate_id,
        streamTenantIds: new Set(),
        userArchived: row.user_archived,
        lastEventId: 0n,
        alive: false,
      };
      pair.streams.set(row.aggregate_id, stream);
    }
    stream.streamTenantIds.add(row.stream_tenant_id);
    stream.lastEventId = BigInt(row.event_id);
    if (row.type === CREATED) {
      if ([...pair.streams.values()].some((other) => other !== stream && other.alive)) {
        pair.collides = true;
      }
      stream.alive = true;
    } else if (ROW_REMOVING_TYPES.includes(row.type)) {
      stream.alive = false;
    }
  }
  return pairs;
}

// The stream written last carries the state the live row was built from; an alive one beats a removed one.
function streamToKeep(streams: readonly MembershipStream[]): MembershipStream | undefined {
  const newestFirst = [...streams].sort((a, b) => (a.lastEventId > b.lastEventId ? -1 : 1));
  return newestFirst.find((s) => s.alive) ?? newestFirst[0];
}

export async function findLiveMembershipStreamId(
  db: DbRunner,
  pair: { readonly userId: string; readonly tenantId: string },
): Promise<string | undefined> {
  const history = groupByPair(await readMembershipEvents(db, pair))
    .values()
    .next().value;
  if (!history) return undefined;
  const kept = streamToKeep([...history.streams.values()]);
  return kept?.alive ? kept.aggregateId : undefined;
}

/**
 * Archives the membership streams a projection replay must not see: those of users whose own
 * stream is archived, and the older streams of a (user, tenant) pair whose streams collide.
 */
export async function archiveUnreplayableMembershipStreams(
  db: DbRunner,
): Promise<readonly ArchivedMembershipStream[]> {
  const archived: ArchivedMembershipStream[] = [];
  for (const history of groupByPair(await readMembershipEvents(db)).values()) {
    const streams = [...history.streams.values()];
    // Every stream of a pair belongs to the same user.
    if (streams.some((s) => s.userArchived)) {
      for (const stream of streams) {
        await archiveMembershipStream(db, stream, "user stream archived");
        archived.push({ aggregateId: stream.aggregateId, reason: "user_archived" });
      }
      continue;
    }
    if (!history.collides) continue;
    const kept = streamToKeep(streams);
    if (!kept) continue;
    for (const stream of streams.filter((s) => s !== kept)) {
      await archiveMembershipStream(
        db,
        stream,
        `duplicate of membership stream ${kept.aggregateId}`,
      );
      archived.push({
        aggregateId: stream.aggregateId,
        reason: "duplicate",
        keptAggregateId: kept.aggregateId,
      });
    }
  }
  return archived;
}

async function archiveMembershipStream(
  db: DbRunner,
  stream: MembershipStream,
  reason: string,
): Promise<void> {
  // The replay filter matches archive markers per (stream tenant, aggregate).
  for (const streamTenantId of stream.streamTenantIds) {
    const tenantId = parseTenantId(streamTenantId);
    if (tenantId === null) {
      throw new Error(
        `membership stream ${stream.aggregateId} sits on non-uuid tenant "${streamTenantId}"`,
      );
    }
    await archiveStream(db, {
      tenantId,
      aggregateId: stream.aggregateId,
      aggregateType: MEMBERSHIP_AGGREGATE,
      archivedBy: ARCHIVED_BY,
      reason,
    });
  }
}
