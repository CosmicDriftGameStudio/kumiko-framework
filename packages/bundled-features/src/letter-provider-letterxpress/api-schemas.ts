import * as z from "zod";
import { LETTERXPRESS_JOB_STATUSES } from "./constants.ts";

const itemSchema = z.object({
  address: z.string(),
  pages: z.number(),
  amount: z.number(),
  vat: z.number(),
  status: z.string(),
  tracking_code: z.string().nullish(),
  tracking_status: z.string().nullish(),
});

export const printJobSchema = z.object({
  id: z.number().int(),
  status: z.enum(LETTERXPRESS_JOB_STATUSES),
  notice: z.string().nullish(),
  registered: z.string().nullish(),
  items: z.array(itemSchema).min(1),
});
export type LetterXpressPrintJob = z.infer<typeof printJobSchema>;

export const balanceDataSchema = z.object({ balance: z.number(), currency: z.string() });
export type LetterXpressBalance = z.infer<typeof balanceDataSchema>;

export const priceDataSchema = z.object({ price: z.number() });
export type LetterXpressPrice = z.infer<typeof priceDataSchema>;

export const printJobListSchema = z.object({
  printjobs: z.array(printJobSchema),
  pagination: z.object({ current_page: z.number().int(), last_page: z.number().int() }),
});
export type LetterXpressPrintJobList = z.infer<typeof printJobListSchema>;

export const errorBodySchema = z.object({ message: z.string().optional() });

export function envelopeOf<T extends z.ZodType>(data: T) {
  return z.object({ data });
}
