import { z } from "zod";
import { ACCOUNT_TYPES, TRANSACTION_STATUS } from "./constants";

// A posting line. amount is integer minor units (cents), SIGNED: Soll/debit > 0,
// Haben/credit < 0. Integer → the balance check is exact (=== 0), no float epsilon.
export const postingSchema = z.object({
  accountId: z.string().min(1).max(64),
  amount: z.number().int(),
});
export type Posting = z.infer<typeof postingSchema>;

const sumIsZero = (lines: readonly Posting[]): boolean =>
  lines.reduce((s, l) => s + l.amount, 0) === 0;

const touchesTwoAccounts = (lines: readonly Posting[]): boolean =>
  new Set(lines.map((l) => l.accountId)).size >= 2;

// create-transaction — a balanced journal entry. The two invariants of
// double-entry live here at the command boundary: every entry balances (Σ=0)
// and moves value between at least two distinct accounts.
export const createTransactionPayloadSchema = z
  .object({
    date: z.string().min(1).max(32), // ISO booking date
    description: z.string().min(1).max(200),
    reference: z.string().max(120).optional(),
    // Defaults to "posted" in the handler. draft lifecycle (editable) lands with
    // the Soll/recurring work — Phase 0 only ever creates posted entries.
    status: z.enum(TRANSACTION_STATUS).optional(),
    lines: z.array(postingSchema).min(2),
  })
  .refine((p) => sumIsZero(p.lines), {
    message: "Transaction must balance: Σ of posting amounts must equal 0",
    path: ["lines"],
  })
  .refine((p) => touchesTwoAccounts(p.lines), {
    message: "Transaction must touch at least 2 distinct accounts",
    path: ["lines"],
  });
export type CreateTransactionPayload = z.infer<typeof createTransactionPayloadSchema>;

// reverse-transaction (Storno) — corrects a posted entry by booking its mirror,
// never by mutating it. Optional date/description for the reversing entry.
export const reverseTransactionPayloadSchema = z.object({
  id: z.string().min(1).max(64),
  date: z.string().min(1).max(32).optional(),
  description: z.string().min(1).max(200).optional(),
});
export type ReverseTransactionPayload = z.infer<typeof reverseTransactionPayloadSchema>;

// Re-export so callers building accounts have the type vocabulary in one place.
export const accountTypeSchema = z.enum(ACCOUNT_TYPES);
