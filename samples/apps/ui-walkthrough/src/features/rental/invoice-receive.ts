import { fieldToZod, withFormDerivations } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { receiveInvoiceLines, receiveInvoiceScreen } from "./screens";

const moneyPayload = z.object({ amount: z.number(), currency: z.string().min(1) });

// Totals are recomputed from the lines before validation, so a client-sent
// total never reaches the handler.
export const receiveInvoicePayloadSchema = withFormDerivations(
  z.object({
    supplier: z.string().min(1),
    invoiceNumber: z.string().min(1),
    lines: fieldToZod(receiveInvoiceLines, ["EUR"]),
    netTotal: moneyPayload,
    vatRate: z.number().optional(),
    vatTotal: moneyPayload,
    grossTotal: moneyPayload,
  }),
  receiveInvoiceScreen,
);
