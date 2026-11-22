import * as z from "zod";
import {
  LETTER_ENVELOPES,
  LETTER_FAILURE_REASONS,
  LETTER_FORM_REQUIREMENTS,
  LETTER_SHIPPING_MODES,
  LETTER_STATES,
} from "./constants.ts";

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
  envelope: z.enum(LETTER_ENVELOPES).optional(),
  color: z.boolean(),
  duplex: z.boolean(),
  formRequirement: z.enum(LETTER_FORM_REQUIREMENTS),
  formRiskAcknowledged: z.boolean().optional(),
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

const MoneySchema = z.object({
  amount: z.number().int().nonnegative(),
  currency: z.string().min(3),
});

export const RecordAcceptanceSchema = z.object({
  letterId: z.uuid(),
  providerJobId: z.string().min(1).max(200),
  actualNet: MoneySchema,
  actualVat: MoneySchema,
  recognizedAddress: z.string().optional(),
  cancelableUntil: z.string().optional(),
  trackingNumber: z.string().max(200).optional(),
});
export type RecordAcceptance = z.infer<typeof RecordAcceptanceSchema>;

export const RecordRejectionSchema = z.object({
  letterId: z.uuid(),
  failureReason: z.enum(LETTER_FAILURE_REASONS),
  failureDetail: z.string().max(500).optional(),
});

export const ApplyProviderStatusSchema = z.object({
  letterId: z.uuid(),
  to: z.enum(["accepted", "on-hold", "sent", "failed", "canceled", "returned"]).optional(),
  trackingNumber: z.string().max(200).optional(),
  trackingStatus: z.string().max(200).optional(),
  recognizedAddress: z.string().optional(),
  proofFileRefIds: z.array(z.uuid()).optional(),
  addressMismatch: z.boolean().optional(),
  failureReason: z.enum(LETTER_FAILURE_REASONS).optional(),
  failureDetail: z.string().max(500).optional(),
});

export const ResolveUnknownSchema = z.object({
  letterId: z.uuid(),
  note: z.string().trim().min(1).max(2000),
  providerJobId: z.string().min(1).max(200).optional(),
});
