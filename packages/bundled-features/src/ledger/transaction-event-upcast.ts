import { isUuid } from "@cosmicdrift/kumiko-framework/engine";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import type { EntityEventMigration } from "@cosmicdrift/kumiko-types/fields";

// v1 transaction events carried the Storno link in `reference` (= the reversed
// entry's id) and the schedule period as `schedule:<scheduleId>:<period>`.
const LEGACY_SCHEDULE_REFERENCE = /^schedule:([^:]+):(\d{4}-\d{2})$/;

// A Storno of a Storno chains one hop per level; real books stay far below this.
const MAX_REVERSAL_HOPS = 16;

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
    aggregateType: "transaction",
    atVersion: 1,
  });
  return events.find((e) => e.type === "transaction.created")?.payload;
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
// existing transaction of the tenant marks the Storno.
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
    const original = await scheduleLinkOfOriginal(ctx, reference);
    return {
      ...fields,
      reversesTransactionId: reference,
      ...(original !== undefined && { scheduleId: original.scheduleId, period: original.period }),
    };
  },
};
