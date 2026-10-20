import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { templateBundleSchema } from "../template-bundle.ts";
import {
  refuseTemplateEdit,
  type TemplateEditPolicy,
  templateEditAccess,
} from "../template-edit-policy.ts";
import { importTemplateBundle, prepareTemplateBundleBeforeTransaction } from "./bundle-import.ts";

export function makeImportBundleWrite(policy: TemplateEditPolicy) {
  return defineWriteHandler({
    name: "import-bundle",
    schema: z.object({ bundle: templateBundleSchema, overwrite: z.boolean().default(false) }),
    access: templateEditAccess(policy.tenantEditable),
    description:
      "Imports a template bundle (all locales plus resource files, as produced by export-bundle) into the caller's tenant as drafts; it refuses a locale that already has an override unless overwrite is set, and publish makes the drafts live. Outside the templates the app lists in tenantEditable only a SystemAdmin may use it.",
    beforeTransaction: async (event, ctx) =>
      refuseTemplateEdit(policy, event.user, event.payload.bundle) ??
      prepareTemplateBundleBeforeTransaction({
        ctx,
        user: event.user,
        tenantId: event.user.tenantId,
        scope: "tenant",
        status: "draft",
        bundle: event.payload.bundle,
        overwrite: event.payload.overwrite,
      }),
    handler: async (event, ctx) =>
      refuseTemplateEdit(policy, event.user, event.payload.bundle) ??
      importTemplateBundle({
        ctx,
        user: event.user,
        tenantId: event.user.tenantId,
        scope: "tenant",
        status: "draft",
        bundle: event.payload.bundle,
        overwrite: event.payload.overwrite,
        prepared: event.prepared,
      }),
  });
}
