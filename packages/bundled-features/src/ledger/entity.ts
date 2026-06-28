import {
  createDateField,
  createEntity,
  createJsonbField,
  createSelectField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";
import { ACCOUNT_TYPES, TRANSACTION_STATUS } from "./constants";

// account — a node in the chart of accounts. Event-sourced (create/update/list/
// detail via the standard handlers); the framework projects `read_ledger_accounts`
// from its CRUD events. `parentId` null → root account; otherwise the chart-of-
// accounts tree. `type` drives how the report layer interprets a balance. No
// money column — balances are DERIVED from postings (Phase 1), never stored.
// tenantId is a base column set by the framework → each tenant has its own books.
export const accountEntity = createEntity({
  table: "read_ledger_accounts",
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
// `lines` (jsonb: { accountId, amount }[], Σ amount = 0), so an entry is atomic:
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
  fields: {
    date: createDateField({ required: true }),
    // Journal narration ("Miete Januar", "Storno: …") is accounting data, not
    // user-generated PII → allowPlaintext silences the user-content heuristic.
    description: createTextField({
      required: true,
      maxLength: 200,
      allowPlaintext: "is-business-data",
    }),
    // For a Storno entry this points at the reversed transaction's id.
    reference: createTextField({ maxLength: 120 }),
    status: createSelectField({ options: TRANSACTION_STATUS, required: true }),
    lines: createJsonbField(),
  },
});
