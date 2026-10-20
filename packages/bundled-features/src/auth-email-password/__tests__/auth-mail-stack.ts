import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature.ts";
import { createTemplateResolverFeature } from "../../template-resolver/feature.ts";
import { seedNotificationTemplates } from "../../template-resolver/seeding.ts";
import { AuthMailNotificationTypes } from "../mail-notifications.ts";

// Auth mails are stored templates rendered by the mail renderer, so every
// stack that sends one needs these features plus the boot seed (setupTestStack
// does not run boot seeds).
export function authMailRendererFeatures(): FeatureDefinition[] {
  return [
    createTemplateResolverFeature({
      tenantEditable: [
        {
          kind: "mail",
          slug: AuthMailNotificationTypes.invite,
          access: { roles: ["TenantAdmin"] },
        },
      ],
    }),
    createRendererFoundationFeature(),
    createRendererMailHtmlFeature(),
  ];
}

export async function seedAuthMailTemplates(stack: TestStack): Promise<void> {
  await seedNotificationTemplates(stack.db, stack.registry);
}
