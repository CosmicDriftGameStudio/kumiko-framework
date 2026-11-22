import {
  LETTER_FORM_REQUIREMENTS,
  LetterAddressSchema,
  sendLetter,
} from "@cosmicdrift/kumiko-bundled-features/letter-foundation";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

const SendStatementLetterSchema = z.object({
  statementId: z.string().min(1),
  fileRefId: z.uuid(),
  recipient: LetterAddressSchema,
  formRequirement: z.enum(LETTER_FORM_REQUIREMENTS),
  formRiskAcknowledged: z.boolean().optional(),
});

export function createStatementsFeature(): FeatureDefinition {
  return defineFeature("statements", (r) => {
    r.describe("Sample app feature: sends a statement PDF as a letter through letter-foundation.");
    r.requires({ features: ["letter-foundation"] });

    r.writeHandler({
      name: "send-statement-letter",
      schema: SendStatementLetterSchema,
      access: { roles: ["TenantAdmin"] },
      handler: async (event, ctx) => {
        const { statementId, fileRefId, recipient, formRequirement, formRiskAcknowledged } =
          event.payload;
        return sendLetter(ctx, {
          fileRefIds: [fileRefId],
          expectedRecipient: recipient,
          shippingMode: "standard",
          color: false,
          duplex: true,
          formRequirement,
          ...(formRiskAcknowledged !== undefined && { formRiskAcknowledged }),
          // The same statement to the same address must never produce a second letter,
          // however often the caller retries; a changed address is a new letter.
          idempotencyKey: `statement:${statementId}:${recipient.postalCode}:${recipient.street}:${recipient.houseNumber}`,
          source: { entityType: "statement", entityId: statementId },
        });
      },
    });
  });
}
