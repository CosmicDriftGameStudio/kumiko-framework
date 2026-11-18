import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { isUuid } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable, loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import type { EntityEventMigration } from "@cosmicdrift/kumiko-types/fields";

// v1 transaction events carried the Storno link in `reference` (= the reversed
// entry's id) and the schedule period as `schedule:<scheduleId>:<period>`.
const LEGACY_SCHEDULE_REFERENCE = /^schedule:([^:]+):(\d{4}-\d{2})$/;

// A Storno of a Storno chains one hop per level; real books stay far below this.
const MAX_REVERSAL_HOPS = 16;

const TRANSACTION_AGGREGATE_TYPE = "transaction";
const TRANSACTION_CREATED_EVENT = "transaction.created";
const LEGACY_EVENT_VERSION = 1;

type UpcastCtx = Parameters<EntityEventMigration["transform"]>[1];
type ScheduleLink = { readonly scheduleId: string; readonly period: string };

function legacyScheduleLink(reference: unknown): ScheduleLink | undefined {
  if (typeof reference !== "string") return undefined;
  const match = LEGACY_SCHEDULE_REFERENCE.exec(reference);
  if (match === null) return undefined;
  const [, scheduleId, period] = match;
  return scheduleId === undefined || period === undefined ? undefined : { scheduleId, period };
}

function storedScheduleLink(payload: Readonly<Record<string, unknown>>): ScheduleLink | undefined {
  const { scheduleId, period } = payload;
  if (typeof scheduleId === "string" && typeof period === "string") return { scheduleId, period };
  return legacyScheduleLink(payload["reference"]);
}

async function loadCreatedPayload(
  ctx: UpcastCtx,
  transactionId: string,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  if (!isUuid(transactionId)) return undefined;
  const events = await loadAggregate(ctx.db, transactionId, ctx.tenantId, {
    aggregateType: TRANSACTION_AGGREGATE_TYPE,
    atVersion: 1,
  });
  return events.find((e) => e.type === TRANSACTION_CREATED_EVENT)?.payload;
}

// reversesTransactionId is unique per tenant, but v1 had no lock: a double Storno click, or a
// free reference naming a booking, left several v1 bookings naming one original. The first one
// in event order keeps the link, so a rebuild stays deterministic and never hits the index.
async function isFirstLegacyBookingReferencing(
  ctx: UpcastCtx,
  originalId: string,
): Promise<boolean> {
  const [firstBooking] = await selectMany<{ aggregateId: string }>(
    ctx.db,
    eventsTable,
    {
      tenantId: ctx.tenantId,
      aggregateType: TRANSACTION_AGGREGATE_TYPE,
      type: TRANSACTION_CREATED_EVENT,
      eventVersion: LEGACY_EVENT_VERSION,
      payload: { jsonText: { keys: ["reference"], eq: originalId } },
    },
    { fields: ["aggregateId"], orderBy: { col: "id", direction: "asc" }, limit: 1 },
  );
  return firstBooking === undefined || firstBooking.aggregateId === ctx.aggregateId;
}

// A Storno copies scheduleId and period from its original, which may itself be
// a v1 Storno or a v1 schedule booking; follow the chain on the raw payloads.
async function scheduleLinkOfOriginal(
  ctx: UpcastCtx,
  originalId: string,
): Promise<ScheduleLink | undefined> {
  let currentId = originalId;
  for (let hop = 0; hop < MAX_REVERSAL_HOPS; hop++) {
    const payload = await loadCreatedPayload(ctx, currentId);
    if (payload === undefined) return undefined;
    const link = storedScheduleLink(payload);
    if (link !== undefined) return link;
    const next = payload["reversesTransactionId"] ?? payload["reference"];
    if (typeof next !== "string") return undefined;
    currentId = next;
  }
  return undefined;
}

// Same detection as the legacy findReversedIds: a reference that names an
// existing transaction of the tenant marks the Storno, if no earlier booking claimed it.
export const deriveTransactionSystemLinks: EntityEventMigration = {
  fromVersion: 1,
  toVersion: 2,
  transform: async (fields, ctx) => {
    if (fields["reversesTransactionId"] != null || fields["scheduleId"] != null) return fields;

    const scheduleLink = legacyScheduleLink(fields["reference"]);
    if (scheduleLink !== undefined) {
      return { ...fields, scheduleId: scheduleLink.scheduleId, period: scheduleLink.period };
    }

    const reference = fields["reference"];
    if (typeof reference !== "string" || (await loadCreatedPayload(ctx, reference)) === undefined) {
      return fields;
    }
    if (!(await isFirstLegacyBookingReferencing(ctx, reference))) return fields;
    const original = await scheduleLinkOfOriginal(ctx, reference);
    return {
      ...fields,
      reversesTransactionId: reference,
      ...(original !== undefined && { scheduleId: original.scheduleId, period: original.period }),
    };
  },
};
