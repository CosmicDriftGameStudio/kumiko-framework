import {
  type BeforeTransactionResult,
  defineWriteHandler,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
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
} from "../../file-foundation/index.ts";
import { attachmentFileNameSchema } from "../../shared/index.ts";
import {
  type PreparedTemplateFile,
  prepareTemplateAttachmentBeforeTransaction,
  prepareTemplateResourceBeforeTransaction,
  readTemplateResourceMaxBytes,
  type StoredTemplateAttachment,
  type StoredTemplateResource,
  storePreparedTemplateAttachment,
  storePreparedTemplateResource,
} from "../store-template-resource.ts";
import {
  refuseTemplateEditById,
  type TemplateEditPolicy,
  templateEditAccess,
} from "../template-edit-policy.ts";
import { TemplateResolverErrors } from "../web/qualified-names.ts";
import { RESOURCE_PURPOSES, resourceKeySchema, resourceTargetTenantId } from "./resource-shared.ts";

type AttachmentTarget = {
  readonly templateId: string;
  readonly key: string;
  readonly fileName: string;
};

function attachmentTargetOf(input: {
  readonly templateId: string | undefined;
  readonly key: string | undefined;
  readonly fileName: string | undefined;
}): AttachmentTarget | null {
  const { templateId, key, fileName } = input;
  if (templateId === undefined || key === undefined || fileName === undefined) return null;
  const parsedName = attachmentFileNameSchema.safeParse(fileName);
  return parsedName.success ? { templateId, key, fileName: parsedName.data } : null;
}

// Purpose "image": stores a re-encoded image as a FileRef and, with templateId + key, links it into
// the template; without templateId it only creates the FileRef (the branding logo upload path).
// Purpose "attachment": stores the file as uploaded and links it as a mail attachment.
export function makeResourceUploadWrite(policy: TemplateEditPolicy) {
  return defineWriteHandler({
    name: "resource-upload",
    schema: z
      .object({
        templateId: z.string().min(1).optional(),
        key: resourceKeySchema.optional(),
        /** An unclaimed upload of the caller (POST /api/files without entityType). */
        sourceFileRefId: z.uuid(),
        /** Cross-tenant target — SystemAdmin only. */
        tenantIdOverride: z.string().min(1).optional(),
        /** "attachment" links a PDF/PNG/JPEG as a file attached to every mail of the template. */
        purpose: z.enum(RESOURCE_PURPOSES).default("image"),
        /** Name the recipient sees; required for purpose "attachment". */
        fileName: z.string().optional(),
      })
      .refine(
        (p) => p.purpose === "attachment" || (p.templateId === undefined) === (p.key === undefined),
        {
          message: "templateId and key must be given together",
          path: ["key"],
        },
      ),
    access: templateEditAccess(policy.tenantEditable),
    description:
      "Turns a file uploaded via POST /api/files (multipart, no entityType) into a template resource. With purpose image (default) the upload is checked against the resource-max-bytes cap, re-encoded to a supported image format and stored as a new file; with templateId and key it is linked into that template under the key, without them only the file is created. With purpose attachment, templateId, key and fileName are required: a PDF, PNG or JPEG is stored unchanged and linked into a mail template as a file attached to every mail sent from it, at most 10 per template. A cap above the files route's maxUploadSize has no effect. Only a SystemAdmin and the roles of the templates the app lists in tenantEditable may use it; such a role may link only into those templates.",
    beforeTransaction: async (
      event,
      ctx,
    ): Promise<BeforeTransactionResult<PreparedTemplateFile>> => {
      const { templateId, key, sourceFileRefId, purpose, fileName } = event.payload;
      const attachmentTarget =
        purpose === "attachment" ? attachmentTargetOf({ templateId, key, fileName }) : null;
      if (purpose === "attachment" && attachmentTarget === null) {
        return writeFailure(
          new UnprocessableError(TemplateResolverErrors.attachmentInvalid, {
            i18nKey: "templateResolver.errors.attachment.invalid",
            details: { code: "target_required" },
          }),
        );
      }
      if (templateId !== undefined) {
        const refused = await refuseTemplateEditById(
          ctx.db,
          policy,
          event.user,
          resourceTargetTenantId(event.payload.tenantIdOverride, event.user.tenantId),
          templateId,
        );
        if (refused !== null) return refused;
      }
      const maxBytes = await readTemplateResourceMaxBytes(ctx.config, ctx.registry);

      // The source is read from the session tenant only: with tenantIdOverride the upload
      // sits in the admin's own tenant while the normalized file lands in the target tenant.
      // Only the caller's own unclaimed upload qualifies, so a record-attached image of
      // someone else cannot be copied into a template.
      let source: Awaited<ReturnType<typeof readFileRefContent>>;
      try {
        source = await readFileRefContent({
          db: ctx.db,
          filesForTenant: (tid) => fileContextForTenant(ctx, ctx.user.tenantId, tid),
          fileRefId: sourceFileRefId,
          allowedTenantIds: [event.user.tenantId],
          unclaimedUploadOf: event.user.id,
          maxBytes,
        });
      } catch (cause) {
        if (cause instanceof FileRefTooLargeError) {
          return writeFailure(
            new UnprocessableError(TemplateResolverErrors.resourceTooLarge, {
              i18nKey: "templateResolver.errors.resource.tooLarge",
              details: { maxBytes, size: cause.size },
            }),
          );
        }
        throw cause;
      }
      if (source === null) return writeFailure(new NotFoundError("file-ref", sourceFileRefId));

      // The source upload stays as an unclaimed file: bundled-features cannot reach the fileRef executor to delete it.
      const tenantId = resourceTargetTenantId(event.payload.tenantIdOverride, event.user.tenantId);
      if (attachmentTarget !== null) {
        return prepareTemplateAttachmentBeforeTransaction({
          ctx,
          user: event.user,
          tenantId,
          bytes: source.content,
          maxBytes,
          ...attachmentTarget,
        });
      }
      return prepareTemplateResourceBeforeTransaction({
        ctx,
        user: event.user,
        tenantId,
        bytes: source.content,
        maxBytes,
        ...(templateId !== undefined && { templateId }),
        ...(key !== undefined && { key }),
      });
    },
    handler: async (
      event,
      ctx,
    ): Promise<WriteResult<StoredTemplateResource | StoredTemplateAttachment>> => {
      const { templateId, key } = event.payload;
      const tenantId = resourceTargetTenantId(event.payload.tenantIdOverride, event.user.tenantId);
      const { prepared } = event;
      if (prepared.kind === "attachment") {
        // The phase accepts attachments only with a complete target, so these are set.
        if (templateId === undefined || key === undefined) {
          return writeFailure(
            new UnprocessableError(TemplateResolverErrors.attachmentInvalid, {
              i18nKey: "templateResolver.errors.attachment.invalid",
              details: { code: "target_required" },
            }),
          );
        }
        return storePreparedTemplateAttachment({
          ctx,
          user: event.user,
          tenantId,
          prepared,
          templateId,
          key,
        });
      }
      return storePreparedTemplateResource({
        ctx,
        user: event.user,
        tenantId,
        prepared,
        ...(templateId !== undefined && { templateId }),
        ...(key !== undefined && { key }),
      });
    },
  });
}
