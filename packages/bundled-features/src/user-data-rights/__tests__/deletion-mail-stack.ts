import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { type TestStack, unsafePushTables } from "@cosmicdrift/kumiko-testing/stack";
import {
  authMailRendererFeatures,
  seedAuthMailTemplates,
} from "../../auth-email-password/__tests__/auth-mail-stack.ts";
import {
  createChannelEmailFeature,
  type EmailMessage,
  type EmailTransport,
} from "../../channel-email/index.ts";
import { configValuesTable, createConfigFeature } from "../../config/index.ts";
import { createDeliveryFeature } from "../../delivery/index.ts";
import { deliveryAttemptsTable, notificationPreferencesTable } from "../../delivery/tables.ts";
import { createTenantFeature } from "../../tenant/index.ts";

// The anonymous deletion verify mail goes through delivery -> channel-email and
// is rendered from a seeded template, so every stack that sends it needs these.
export function deletionMailFeatures(transport: EmailTransport): FeatureDefinition[] {
  return [
    createConfigFeature(),
    createTenantFeature(),
    createDeliveryFeature(),
    // route:{email} delivers directly, resolveEmail (userId -> address) is never hit.
    createChannelEmailFeature({ transport, resolveEmail: async () => null }),
    ...authMailRendererFeatures(),
  ];
}

export async function prepareDeletionMailStack(stack: TestStack): Promise<void> {
  await unsafePushTables(stack.db, {
    configValuesTable,
    notificationPreferencesTable,
    deliveryAttemptsTable,
  });
  await seedAuthMailTemplates(stack);
}

// The text part carries the plain URL; the HTML part is entity-encoded.
export function verifyTokenFromMail(mail: EmailMessage, verifyUrl: string): string {
  const link = /https?:\/\/\S+#token=[^\s)\]>"]+/.exec(mail.text ?? "")?.[0];
  if (link === undefined || !link.startsWith(`${verifyUrl}#token=`)) {
    throw new Error(`mail to ${mail.to} has no verify link starting with ${verifyUrl}#token=`);
  }
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get("token");
  if (!token) throw new Error(`verify link in mail to ${mail.to} carries no token`);
  return token;
}
