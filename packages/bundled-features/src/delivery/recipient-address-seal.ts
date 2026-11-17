import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import type { EnvelopeCipher } from "@cosmicdrift/kumiko-framework/secrets";
import * as z from "zod";

// Queued delivery jobs sit in Redis and the job-run table, so the recipient address travels
// sealed under the app master key. Without a master key it stays plaintext (`address`); jobs
// queued before sealing existed carry `address` too and keep working.
// Exactly one of the two fields: both or neither fails the payload parse.
export const recipientAddressFieldSchema = z.union([
  z.object({ address: z.string(), sealedAddress: z.undefined().optional() }),
  z.object({ sealedAddress: z.string(), address: z.undefined().optional() }),
]);

export type RecipientAddressField = z.infer<typeof recipientAddressFieldSchema>;

// The cipher is shared with config values and PII entity fields and has no AAD, so the purpose is
// bound inside the authenticated plaintext. Without it a foreign ciphertext of the same tenant
// placed into sealedAddress would be decrypted and its plaintext sent to the channel. The tenant
// is bound there too: the env key provider ignores the encrypt scope, so a sealedAddress of tenant
// B would otherwise open inside a job of tenant A.
const RECIPIENT_ADDRESS_PURPOSE = "delivery.recipientAddress";

const sealedRecipientAddressSchema = z.object({
  purpose: z.literal(RECIPIENT_ADDRESS_PURPOSE),
  tenantId: z.string(),
  address: z.string(),
});

export async function sealRecipientAddress(
  address: string,
  tenantId: TenantId,
  cipher: EnvelopeCipher | undefined,
): Promise<RecipientAddressField> {
  if (!cipher) return { address };
  const plaintext = JSON.stringify({ purpose: RECIPIENT_ADDRESS_PURPOSE, tenantId, address });
  return { sealedAddress: await cipher.encrypt(plaintext, { tenantId }) };
}

function parseSealedRecipientAddress(plaintext: string, tenantId: TenantId): string {
  let decoded: unknown;
  try {
    decoded = JSON.parse(plaintext);
  } catch {
    decoded = undefined;
  }
  const parsed = sealedRecipientAddressSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.tenantId !== tenantId) {
    throw new InternalError({
      message: "delivery job: sealedAddress was not sealed as a delivery recipient address",
    });
  }
  return parsed.data.address;
}

export async function openRecipientAddress(
  payload: RecipientAddressField,
  tenantId: TenantId,
  cipher: EnvelopeCipher | undefined,
): Promise<string> {
  if (payload.sealedAddress === undefined) return payload.address;
  if (!cipher) {
    throw new InternalError({
      message:
        "delivery job: payload carries a sealed recipient address but this process has no master key (configEncryption); run the worker with the same KUMIKO_SECRETS_MASTER_KEY_V<n> as the web process",
    });
  }
  return parseSealedRecipientAddress(
    await cipher.decrypt(payload.sealedAddress, { tenantId }),
    tenantId,
  );
}
