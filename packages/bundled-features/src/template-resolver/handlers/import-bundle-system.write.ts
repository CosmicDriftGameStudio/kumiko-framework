import { defineWriteHandler, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { ValidationError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { templateBundleSchema } from "../template-bundle.js";
import { importTemplateBundle, prepareTemplateBundleBeforeTransaction } from "./bundle-import.js";

export const importBundleSystemWrite = defineWriteHandler({
  name: "import-bundle-system",
  schema: z.object({ bundle: templateBundleSchema }),
  access: { roles: ["SystemAdmin"] },
  // A system template change reaches every tenant without an override.
  agent: { risk: "high" as const },
  description:
    "Imports a template bundle as system-default templates, active straight away and overwriting existing system rows; SystemAdmin only. Bundles with resource files need a caller in the system tenant, because the files are stored in the caller's file space.",
  beforeTransaction: async (event, ctx) => {
    const { bundle } = event.payload;
    // Must run before any upload.
    if (Object.keys(bundle.resources).length > 0 && event.user.tenantId !== SYSTEM_TENANT_ID) {
      return writeFailure(
        new ValidationError({
          fields: [
            {
              path: "bundle.resources",
              code: "system_resources_need_system_tenant",
              i18nKey: "templateResolver.errors.template.systemResourcesNeedSystemTenant",
            },
          ],
        }),
      );
    }
    return prepareTemplateBundleBeforeTransaction({
      ctx,
      user: event.user,
      tenantId: SYSTEM_TENANT_ID,
      scope: "system",
      status: "active",
      bundle,
      overwrite: true,
    });
  },
  handler: (event, ctx) =>
    importTemplateBundle({
      ctx,
      user: event.user,
      tenantId: SYSTEM_TENANT_ID,
      scope: "system",
      status: "active",
      bundle: event.payload.bundle,
      overwrite: true,
      prepared: event.prepared,
    }),
});
