import * as z from "zod";
import { MAX_SIGNATURE_PNG_BYTES } from "./png.ts";
import { SIGNATURE_LEVEL } from "./web/constants.ts";

export const MAX_SIGNERS_PER_REQUEST = 20;
const MAX_VALIDITY_DAYS = 365;
// Base64 inflates by 4/3; the png checks apply to the decoded bytes.
const MAX_IMAGE_BASE64_LENGTH = Math.ceil((MAX_SIGNATURE_PNG_BYTES * 4) / 3) + 4;
const MAX_TOKEN_LENGTH = 2000;

const SignerInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  role: z.string().trim().min(1).max(100).optional(),
  contactId: z.string().min(1).max(64).optional(),
  email: z.string().trim().min(3).max(320).optional(),
});

export const RequestSignatureSchema = z.object({
  documentFileId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  level: z.literal(SIGNATURE_LEVEL.Simple).default(SIGNATURE_LEVEL.Simple),
  subjectType: z.string().trim().min(1).max(100),
  subjectId: z.string().trim().min(1).max(100),
  expiresInDays: z.number().int().min(1).max(MAX_VALIDITY_DAYS).optional(),
  signers: z.array(SignerInputSchema).min(1).max(MAX_SIGNERS_PER_REQUEST),
});

export type RequestSignatureInput = z.infer<typeof RequestSignatureSchema>;

const ImagePayload = z.string().min(1).max(MAX_IMAGE_BASE64_LENGTH);

export const SignInPersonSchema = z.object({
  signerId: z.uuid(),
  imagePngBase64: ImagePayload,
});

export const SignerIdSchema = z.object({ signerId: z.uuid() });

export const RequestIdSchema = z.object({ requestId: z.uuid() });

const TokenPayload = z.string().min(1).max(MAX_TOKEN_LENGTH);

export const OpenByLinkSchema = z.object({ token: TokenPayload });

export const SignByLinkSchema = z.object({ token: TokenPayload, imagePngBase64: ImagePayload });

export const DeclineByLinkSchema = z.object({
  token: TokenPayload,
  reason: z.string().trim().min(1).max(1000).optional(),
});

export const FinishSchema = z.object({ requestId: z.uuid(), completedFileId: z.uuid() });

const OutcomeBase = {
  requestId: z.string().min(1),
  subjectType: z.string().min(1),
  subjectId: z.string().min(1),
};

export const SignatureCompletedEventSchema = z.object({
  ...OutcomeBase,
  completedFileId: z.string().min(1),
  signerCount: z.number().int().nonnegative(),
});

export const SignatureDeclinedEventSchema = z.object({
  ...OutcomeBase,
  signerId: z.string().min(1),
});

export const SignatureExpiredEventSchema = z.object(OutcomeBase);
