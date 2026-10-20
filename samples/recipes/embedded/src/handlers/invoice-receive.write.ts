import {
  defineWriteHandler,
  fieldToZod,
  withFormDerivations,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { invoiceReceiveLines, invoiceReceiveScreen } from "../screens/invoice-receive.screen";

const moneyPayload = z.object({ amount: z.number(), currency: z.string().min(1) });

// The preprocess recomputes net/VAT/gross before validation: totals sent by the
// client never reach the handler.
const receiveInput = withFormDerivations(
  z.object({
    supplier: z.string().min(1),
    invoiceNumber: z.string().min(1),
    lines: fieldToZod(invoiceReceiveLines, ["EUR"]),
    netTotal: moneyPayload,
    vatRate: z.number().optional(),
    vatTotal: moneyPayload,
    grossTotal: moneyPayload,
  }),
  invoiceReceiveScreen,
);

export const invoiceReceive = defineWriteHandler({
  name: "invoice:receive",
  schema: receiveInput,
  access: { roles: ["Admin"] },
  handler: async (event) => ({
    isSuccess: true,
    data: {
      netTotal: event.payload.netTotal,
      vatTotal: event.payload.vatTotal,
      grossTotal: event.payload.grossTotal,
    },
  }),
});
