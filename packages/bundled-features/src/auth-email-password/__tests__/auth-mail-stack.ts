import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import type { TestStack } from "@cosmicdrift/kumiko-framework/stack";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature.js";
import { createTemplateResolverFeature } from "../../template-resolver/feature.js";
import { seedNotificationTemplates } from "../../template-resolver/seeding.js";

// Auth mails are stored templates rendered by the mail renderer, so every
// stack that sends one needs these features plus the boot seed (setupTestStack
// does not run boot seeds).
export function authMailRendererFeatures(): FeatureDefinition[] {
  return [
    createTemplateResolverFeature(),
    createRendererFoundationFeature(),
    createRendererMailHtmlFeature(),
  ];
}

export async function seedAuthMailTemplates(stack: TestStack): Promise<void> {
  await seedNotificationTemplates(stack.db, stack.registry);
}
