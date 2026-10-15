import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { templateBundleSchema } from "../template-bundle.js";
import { importTemplateBundle } from "./bundle-import.js";

export const importBundleWrite = defineWriteHandler({
  name: "import-bundle",
  schema: z.object({ bundle: templateBundleSchema, overwrite: z.boolean().default(false) }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Imports a template bundle (all locales plus resource files, as produced by export-bundle) into the caller's tenant as drafts; it refuses a locale that already has an override unless overwrite is set, and publish makes the drafts live.",
  handler: (event, ctx) =>
    importTemplateBundle({
      ctx,
      user: event.user,
      tenantId: event.user.tenantId,
      scope: "tenant",
      status: "draft",
      bundle: event.payload.bundle,
      overwrite: event.payload.overwrite,
    }),
});
