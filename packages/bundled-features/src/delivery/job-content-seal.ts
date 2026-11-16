import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import type { EnvelopeCipher } from "@cosmicdrift/kumiko-framework/secrets";
import * as z from "zod";

export const channelMessageSchema = z.object({
  notificationType: z.string(),
  title: z.string(),
  body: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  locale: z.string().optional(),
});

const deliveryJobContentSchema = z.object({
  address: z.string(),
  message: channelMessageSchema,
});

export type DeliveryJobContent = z.infer<typeof deliveryJobContentSchema>;

// Queued delivery jobs sit in Redis and the job-run table, so recipient address and message
// content travel sealed under the app master key. Without a master key they stay plaintext
// (`content`). Exactly one of the two fields: both or neither fails the payload parse.
export const jobContentFieldSchema = z.union([
  z.object({ content: deliveryJobContentSchema, sealedContent: z.undefined().optional() }),
  z.object({ sealedContent: z.string(), content: z.undefined().optional() }),
]);

export type JobContentField = z.infer<typeof jobContentFieldSchema>;

// The cipher is shared with config values and PII entity fields and has no AAD, so the purpose is
// bound inside the authenticated plaintext. Without it a foreign ciphertext of the same tenant
// placed into sealedContent would be decrypted and its plaintext sent to the channel. The tenant
// is bound there too: the env key provider ignores the encrypt scope, so a sealedContent of tenant
// B would otherwise open inside a job of tenant A.
const DELIVERY_JOB_CONTENT_PURPOSE = "delivery.jobContent";

const sealedJobContentSchema = z.object({
  purpose: z.literal(DELIVERY_JOB_CONTENT_PURPOSE),
  tenantId: z.string(),
  content: deliveryJobContentSchema,
});

export async function sealJobContent(
  content: DeliveryJobContent,
  tenantId: TenantId,
  cipher: EnvelopeCipher | undefined,
): Promise<JobContentField> {
  if (!cipher) return { content };
  const plaintext = JSON.stringify({ purpose: DELIVERY_JOB_CONTENT_PURPOSE, tenantId, content });
  return { sealedContent: await cipher.encrypt(plaintext, { tenantId }) };
}

function parseSealedJobContent(plaintext: string, tenantId: TenantId): DeliveryJobContent {
  let decoded: unknown;
  try {
    decoded = JSON.parse(plaintext);
  } catch {
    decoded = undefined;
  }
  const parsed = sealedJobContentSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.tenantId !== tenantId) {
    throw new InternalError({
      message: "delivery job: sealedContent was not sealed as delivery job content",
    });
  }
  return parsed.data.content;
}

export async function openJobContent(
  field: JobContentField,
  tenantId: TenantId,
  cipher: EnvelopeCipher | undefined,
): Promise<DeliveryJobContent> {
  if (field.sealedContent === undefined) return field.content;
  if (!cipher) {
    throw new InternalError({
      message:
        "delivery job: payload carries sealed content but this process has no master key (configEncryption); run the worker with the same KUMIKO_SECRETS_MASTER_KEY_V<n> as the web process",
    });
  }
  return parseSealedJobContent(await cipher.decrypt(field.sealedContent, { tenantId }), tenantId);
}
