import * as z from "zod";
import { LETTER_FORM_REQUIREMENTS, LETTER_SHIPPING_MODES, LETTER_STATES } from "./constants.ts";

export const LetterAddressSchema = z.object({
  name: z.string().trim().min(1).max(200),
  addressExtra: z.string().trim().max(200).optional(),
  street: z.string().trim().min(1).max(200),
  houseNumber: z.string().trim().min(1).max(20),
  postalCode: z.string().trim().min(1).max(20),
  city: z.string().trim().min(1).max(200),
});

export const SendLetterInputSchema = z.object({
  fileRefIds: z.array(z.uuid()).min(1).max(50),
  expectedRecipient: LetterAddressSchema,
  shippingMode: z.enum(LETTER_SHIPPING_MODES),
  color: z.boolean(),
  duplex: z.boolean(),
  formRequirement: z.enum(LETTER_FORM_REQUIREMENTS),
  idempotencyKey: z.string().min(1).max(200),
  source: z.object({
    entityType: z.string().min(1).max(100),
    entityId: z.string().min(1).max(100),
  }),
  costCenterRef: z.string().max(200).optional(),
  latestReceiptDate: z.iso.date().optional(),
});

export type SendLetterInput = z.infer<typeof SendLetterInputSchema>;

export const LetterIdSchema = z.object({ letterId: z.uuid() });

// No address, name or content: the event only says which letter moved and from where.
export const LetterTransitionEventSchema = z.object({
  letterId: z.string().min(1),
  from: z.enum(LETTER_STATES),
});
export type LetterTransitionEvent = z.infer<typeof LetterTransitionEventSchema>;
