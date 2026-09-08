import {
  createDateField,
  createEmbeddedListField,
  createEntity,
  createNumberField,
  createSelectField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";
import { ACCOUNT_TYPES, SCHEDULE_INTERVALS, TRANSACTION_STATUS } from "./constants";

// account — a node in the chart of accounts. Event-sourced (create/update/list/
// detail via the standard handlers); the framework projects `read_ledger_accounts`
// from its CRUD events. `parentId` null → root account; otherwise the chart-of-
// accounts tree. `type` drives how the report layer interprets a balance. No
// money column — balances are DERIVED from postings (Phase 1), never stored.
// tenantId is a base column set by the framework → each tenant has its own books.
export const accountEntity = createEntity({
  table: "read_ledger_accounts",
  description:
    "One node of a tenant's chart of accounts: a name, an asset/liability/equity/income/expense type that decides how reports read its balance, an optional account code and an optional parent account forming the account tree; balances are derived from postings, never stored here.",
  fields: {
    name: createTextField({ required: true, maxLength: 120 }),
    type: createSelectField({ options: ACCOUNT_TYPES, required: true }),
    // Optional account number (Kontonummer / SKR code) — free text in v1.
    code: createTextField({ maxLength: 32 }),
    // Parent account id, or absent for a root account. No FK (event-sourced).
    parentId: createTextField({ maxLength: 64 }),
  },
});

// transaction — a journal entry. The balanced posting lines live embedded as
// `lines` (embedded list: { accountId, amount }[], Σ amount = 0), so an entry is atomic:
// the Σ=0 invariant holds within a single command, no cross-row write. The
// framework projects `read_ledger_transactions`; Phase 1 adds a flat
// `read_ledger_postings` projection (one row per line) for per-account/period
// report queries.
//
// IMMUTABLE: the feature registers NO update/delete handler for transaction. A
// posted entry is a fact; corrections are reverse-transaction (Storno) entries.
// `status` carries draft|posted for the later Soll/Ist work — Phase 0 posts only.
export const transactionEntity = createEntity({
  table: "read_ledger_transactions",
  description:
    "One journal entry: a booking date, a narration, an optional reference (a reversal points at the entry it corrects), a draft/posted status and the embedded posting lines of accountId plus signed minor-unit amount that must sum to zero; posted entries are immutable and corrected only by a reversing entry.",
  fields: {
    date: createDateField({ required: true }),
    // Journal narration ("Miete Januar", "Storno: …") is accounting data, not
    // user-generated PII → `personal: false` silences the user-content heuristic.
    description: createTextField({
      required: true,
      maxLength: 200,
      personal: false,
      reason: "is_business_data",
    }),
    // For a Storno entry this points at the reversed transaction's id.
    reference: createTextField({ maxLength: 120 }),
    status: createSelectField({ options: TRANSACTION_STATUS, required: true }),
    // Posting lines are born with the entry and never change on their own —
    // a correction is a new (reversing) entry. The embedded list validates
    // each line's shape; `money` pins amount to signed integer minor units
    // (the entry's currency is a book-level concern, not per line). The
    // cross-line invariants (Σ=0, ≥2 distinct accounts) stay in
    // createTransactionPayloadSchema.
    lines: createEmbeddedListField(
      {
        accountId: { type: "text", required: true },
        amount: { type: "money", required: true },
      },
      { required: true },
    ),
  },
});

// schedule — a recurring booking template (Dauerauftrag): "book `amount` from
// debitAccount to creditAccount every period from startDate". Event-sourced CRUD
// (create/update/list/detail); the framework projects `read_ledger_schedules`. It
// holds NO bookings — the Soll (forecast) is a pure projection (projectSchedule)
// and the Ist is materialised one period at a time by confirm-schedule-period,
// which books a balanced transaction referencing scheduleReference(id, period).
// amount is stored positive (minor units); the confirm handler assigns the signs.
export const scheduleEntity = createEntity({
  table: "read_ledger_schedules",
  description:
    "One recurring booking template: book a positive minor-unit amount from a debit account to a credit account each interval between a start date and an optional open end; it holds no bookings itself, periods become real entries only when confirmed.",
  fields: {
    description: createTextField({
      required: true,
      maxLength: 200,
      personal: false,
      reason: "is_business_data",
    }),
    startDate: createDateField({ required: true }),
    // Absent → open-ended (projects to the window's end).
    endDate: createDateField(),
    interval: createSelectField({ options: SCHEDULE_INTERVALS, required: true }),
    amount: createNumberField({ required: true, min: 1, integer: true }),
    debitAccountId: createTextField({ required: true, maxLength: 64 }),
    creditAccountId: createTextField({ required: true, maxLength: 64 }),
  },
});
