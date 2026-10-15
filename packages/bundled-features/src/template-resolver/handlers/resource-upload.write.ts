import { defineWriteHandler, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  NotFoundError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import {
  FileRefTooLargeError,
  fileContextForTenant,
  readFileRefContent,
} from "../../file-foundation/index.js";
import { TemplateResolverErrors } from "../qualified-names.js";
import { readTemplateResourceMaxBytes, storeTemplateResource } from "../store-template-resource.js";
import { resourceKeySchema } from "./resource-shared.js";

// Stores an image as a FileRef and, with templateId + key, links it into the template.
// Without templateId it only creates the FileRef (the branding logo upload path).
export const resourceUploadWrite = defineWriteHandler({
  name: "resource-upload",
  schema: z
    .object({
      templateId: z.string().min(1).optional(),
      key: resourceKeySchema.optional(),
      /** An unclaimed upload of the caller (POST /api/files without entityType). */
      sourceFileRefId: z.uuid(),
      /** Cross-tenant target — SystemAdmin only. */
      tenantIdOverride: z.string().min(1).optional(),
    })
    .refine((p) => (p.templateId === undefined) === (p.key === undefined), {
      message: "templateId and key must be given together",
      path: ["key"],
    }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Turns an image uploaded via POST /api/files (multipart, no entityType) into a template resource: the upload is checked against the resource-max-bytes cap, re-encoded to a supported format and stored as a new file; with templateId and key the new file is linked into that template under the key, without them only the file is created. A cap above the files route's maxUploadSize has no effect.",
  handler: async (event, ctx) => {
    const { templateId, key, sourceFileRefId } = event.payload;
    const maxBytes = await readTemplateResourceMaxBytes(ctx.config, ctx.registry);

    // The source is read from the session tenant only: with tenantIdOverride the upload
    // sits in the admin's own tenant while the normalized file lands in the target tenant.
    // Only the caller's own unclaimed upload qualifies, so a record-attached image of
    // someone else cannot be copied into a template.
    let source: Awaited<ReturnType<typeof readFileRefContent>>;
    try {
      source = await readFileRefContent({
        db: ctx.db,
        filesForTenant: (tid) => fileContextForTenant(ctx, tid),
        fileRefId: sourceFileRefId,
        allowedTenantIds: [event.user.tenantId],
        unclaimedUploadOf: event.user.id,
        maxBytes,
      });
    } catch (cause) {
      if (cause instanceof FileRefTooLargeError) {
        return writeFailure(
          new UnprocessableError(TemplateResolverErrors.resourceTooLarge, {
            details: { maxBytes, size: cause.size },
          }),
        );
      }
      throw cause;
    }
    if (source === null) return writeFailure(new NotFoundError("file-ref", sourceFileRefId));

    // The source upload stays as an unclaimed file: bundled-features cannot reach the fileRef executor to delete it.
    // @cast-boundary engine-payload — override is a zod-validated string; forTenant
    // rejects it for non-SystemAdmins.
    const tenantId = (event.payload.tenantIdOverride ?? event.user.tenantId) as TenantId;
    return storeTemplateResource({
      ctx,
      user: event.user,
      tenantId,
      bytes: source.content,
      maxBytes,
      ...(templateId !== undefined && { templateId }),
      ...(key !== undefined && { key }),
    });
  },
});
