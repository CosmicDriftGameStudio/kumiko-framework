import { configuredPiiSubjectKms } from "@cosmicdrift/kumiko-framework/crypto";
import {
  deleteMany,
  deriveEntityTableMeta,
  selectMany,
  type TenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createEntity,
  createTextField,
  EXT_TENANT_DATA,
  type FeatureRegistrar,
  type TenantDataHookCtx,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  CHANNEL_WHATSAPP_FEATURE,
  WHATSAPP_EVENT_RETENTION_DAYS,
  WHATSAPP_RETENTION_CURSOR_ENTITY,
} from "./constants.ts";
import { WHATSAPP_MESSAGE_AGGREGATE_TYPE, WHATSAPP_STATUS_AGGREGATE_TYPE } from "./events.ts";

const RETENTION_PAGE_SIZE = 500;
const RETENTION_ERASE_REASON = "channel-whatsapp:retention";
const TENANT_DESTROY_ERASE_REASON = "channel-whatsapp:tenant-destroy";

// lastEventId: every whatsapp event with an id at or below it already had its stream key erased;
// text because event ids are bigint.
export const whatsappRetentionCursorEntity = createEntity({
  name: WHATSAPP_RETENTION_CURSOR_ENTITY,
  table: "store_whatsapp_retention_cursors",
  softDelete: false,
  fields: {
    tenantId: createTextField({
      required: true,
      maxLength: 36,
      access: { write: access.privileged },
      personal: false,
      reason: "pseudonymous_fk",
    }),
    lastEventId: createTextField({
      required: true,
      maxLength: 20,
      access: { write: access.privileged },
      personal: false,
      reason: "technical_reference",
    }),
  },
  indexes: [{ unique: true, columns: ["tenantId"], name: "store_whatsapp_retention_cursors_tenant" }],
});

export const whatsappRetentionCursorTable = deriveEntityTableMeta(
  whatsappRetentionCursorEntity,
  { source: "unmanaged" },
);

type WhatsappStreamType =
  | typeof WHATSAPP_MESSAGE_AGGREGATE_TYPE
  | typeof WHATSAPP_STATUS_AGGREGATE_TYPE;

function isWhatsappStreamType(value: string): value is WhatsappStreamType {
  return value === WHATSAPP_MESSAGE_AGGREGATE_TYPE || value === WHATSAPP_STATUS_AGGREGATE_TYPE;
}

type StreamEventRow = {
  id: bigint;
  aggregateId: string;
  aggregateType: string;
  createdAt: Temporal.Instant;
};

async function eraseWhatsappStreamKeys(
  db: TenantDb,
  args: { readonly cutoff: Temporal.Instant | undefined; readonly eraseReason: string },
): Promise<number> {
  const kms = configuredPiiSubjectKms();
  const cursorRow = (
    await db.selectMany(whatsappRetentionCursorTable, { tenantId: db.tenantId }, { limit: 1 })
  )[0];
  let cursor = cursorRow === undefined ? undefined : BigInt(cursorRow.lastEventId);
  let cursorStored = cursorRow !== undefined;
  let erased = 0;

  for (;;) {
    const page = await selectMany<StreamEventRow>(
      db,
      eventsTable,
      {
        // Explicit: tenant-mode reads also return SYSTEM_TENANT_ID rows, whose keys are not this tenant's.
        tenantId: db.tenantId,
        aggregateType: { in: [WHATSAPP_MESSAGE_AGGREGATE_TYPE, WHATSAPP_STATUS_AGGREGATE_TYPE] },
        ...(cursor !== undefined && { id: { gt: cursor } }),
      },
      {
        fields: ["id", "aggregateId", "aggregateType", "createdAt"],
        orderBy: { col: "id", direction: "asc" },
        limit: RETENTION_PAGE_SIZE,
      },
    );

    // created_at is the transaction start and can run against id order; a createdAt filter would
    // let the cursor skip an older row with a lower id
    const seen = new Set<string>();
    let lastProcessedId: bigint | undefined;
    let stoppedAtCutoff = false;
    for (const row of page) {
      if (
        args.cutoff !== undefined &&
        Temporal.Instant.compare(row.createdAt, args.cutoff) >= 0
      ) {
        stoppedAtCutoff = true;
        break;
      }
      lastProcessedId = row.id;
      if (!isWhatsappStreamType(row.aggregateType)) continue;
      const streamKey = `${row.aggregateType}:${row.aggregateId}`;
      if (seen.has(streamKey)) continue;
      seen.add(streamKey);
      await kms?.eraseKey(
        { kind: "record", entity: row.aggregateType, id: row.aggregateId },
        { requestId: `${args.eraseReason}:${row.aggregateId}`, eraseReason: args.eraseReason },
      );
      erased += 1;
    }

    if (lastProcessedId !== undefined) {
      const lastEventId = String(lastProcessedId);
      if (cursorStored) {
        await db.updateMany(
          whatsappRetentionCursorTable,
          { lastEventId },
          { tenantId: db.tenantId },
        );
      } else {
        await db.insertOne(whatsappRetentionCursorTable, { tenantId: db.tenantId, lastEventId });
        cursorStored = true;
      }
      cursor = lastProcessedId;
    }

    if (stoppedAtCutoff || page.length < RETENTION_PAGE_SIZE) return erased;
  }
}

export async function runWhatsappRetention(args: {
  readonly db: TenantDb;
  readonly now: Temporal.Instant;
}): Promise<{ readonly streamsErased: number }> {
  const streamsErased = await eraseWhatsappStreamKeys(args.db, {
    cutoff: args.now.subtract({ hours: WHATSAPP_EVENT_RETENTION_DAYS * 24 }),
    eraseReason: RETENTION_ERASE_REASON,
  });
  return { streamsErased };
}

// the subject-keys stage erases only tenant and user keys; the record keys of the streams are only
// reachable through the event log
export async function whatsappTenantDestroyHook(ctx: TenantDataHookCtx): Promise<void> {
  await eraseWhatsappStreamKeys(ctx.db, {
    cutoff: undefined,
    eraseReason: TENANT_DESTROY_ERASE_REASON,
  });
  await deleteMany(ctx.db, whatsappRetentionCursorTable, { tenantId: ctx.tenantId });
}

export function registerWhatsappRetention(
  r: FeatureRegistrar<typeof CHANNEL_WHATSAPP_FEATURE>,
): void {
  r.storeTable(whatsappRetentionCursorTable, {
    reason: "read_side.whatsapp_retention_cursors_direct_write",
  });
  r.applyExtension({ name: EXT_TENANT_DATA, entity: WHATSAPP_RETENTION_CURSOR_ENTITY, destroy: whatsappTenantDestroyHook });
  r.job({
    name: "whatsapp-event-retention",
    trigger: { maintenance: true },
    perTenant: true,
    irreversibleWithoutEntryHandler: "high-risk-or-cron-pipeline",
    concurrency: "skip",
    handler: async (_payload, ctx) => {
      await runWhatsappRetention({ db: ctx.db, now: ctx.tz.now() });
    },
  });
}
