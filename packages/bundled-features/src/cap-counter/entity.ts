import {
  createBigIntField,
  createEntity,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

// cap-counter — one row per (tenantId, capName, periodStart). tenantId
// is added automatically as a base column (Kumiko multi-tenant default).
//
// **Identity model:**
//   - aggregate-id: UUID (required by Kumiko ES)
//   - public natural key: (tenantId, capName, periodStart) — the counter
//     engine derives a deterministic uuidv5 from it so increments use the
//     same stream instead of creating two rows per tenant and cap
//
// **Fields:**
//   - capName: the domain concept ("platform-mails", "ai-tokens-7day",
//     "db-storage-bytes"). Free-form string — the app defines its cap
//     names; the engine does not enumerate them.
//   - value: the current counter value. Tokens, MB, count, etc. — the unit
//     belongs to the app; the engine only counts numbers.
//   - periodStart: timestamp when the current counter period began.
//     A calendar-month reset sets a new periodStart (= new aggregate
//     identity). A rolling window (e.g. AI tokens over 7 days) does not
//     reset periodStart and filters on read with `WHERE timestamp >
//     now() - 7d` over the event-store stream — this is the caller's
//     responsibility.
//   - lastSoftWarnedAt: prevents notification storms. Once the soft cap at
//     110% is reached, subsequent increments must not each send an email to
//     the admin. There is at most one soft warning per period, so this
//     nullable column is reset to null when the period resets.
//
// **What is intentionally not in the entity:**
//   - softLimit / hardLimit / cap-tolerance multipliers — these come from
//     the app's tier map when enforceCap is called. The counter knows
//     nothing about the tier, only how much is being counted.
//   - userId / aggregate reference — counters are scoped to the platform
//     tenant, not to a user (even when a user triggers the increment).
export const capCounterEntity = createEntity({
  table: "read_cap_counters",
  description:
    "One usage counter per tenant, cap name and calendar period, holding the accumulated value and the timestamp of the last soft-limit warning.",
  fields: {
    capName: createTextField({
      required: true,
      maxLength: 100,
      sortable: true,
      searchable: true,
      personal: false,
      reason: "technical_reference",
    }),
    value: createBigIntField({ required: true, default: 0 }),
    periodStart: createTimestampField({ required: true }),
    lastSoftWarnedAt: createTimestampField(),
  },
});
