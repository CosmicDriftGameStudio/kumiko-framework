// kumiko-feature-version: 1
//
// Provider-driven PDF/Scan/Image → normalized-text ingest primitive. No
// hardcoded mime allowlist or size cap — providers register via
// EXT_DOCUMENT_INGEST_PROVIDER (see providers.ts).

import { entityEventName } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createTenantConfig,
  defineFeature,
  EXT_TENANT_DATA,
  type MultiStreamApplyFn,
} from "@cosmicdrift/kumiko-framework/engine";
import { normalizeMimeType } from "@cosmicdrift/kumiko-framework/files";
import * as z from "zod";
import { validateDocumentIngestProviderWiring } from "./boot-checks";
import { documentExtractEntity } from "./entity";
import {
  DOCUMENT_INGEST_AGGREGATE_TYPE,
  DOCUMENT_INGEST_REQUESTED_EVENT_QN,
  DOCUMENT_INGEST_REQUESTED_EVENT_SHORT,
  DOCUMENT_INGEST_SKIPPED_EVENT_QN,
  DOCUMENT_INGEST_SKIPPED_EVENT_SHORT,
  documentIngestRequestedPayloadSchema,
  documentIngestSkippedPayloadSchema,
} from "./events";
import {
  forgetExtractOnFileRefDeletedHook,
  forgetExtractOnFileRefForgottenHook,
} from "./forget-extract-with-file-ref";
import { EXT_DOCUMENT_INGEST_PROVIDER, resolveDocumentIngestProviders } from "./providers";
import { documentExtractTenantDestroyHook } from "./tenant-destroy-hook";

const FEATURE_NAME = "document-ingest-foundation";

const FILE_REF_CREATED = entityEventName("fileRef", "created");
const FILE_REF_RESTORED = entityEventName("fileRef", "restored");
const FILE_REF_DELETED = entityEventName("fileRef", "deleted");
const FILE_REF_FORGOTTEN = entityEventName("fileRef", "forgotten");

type MspApplyContext = Parameters<MultiStreamApplyFn>[2];

// Missing/invalid fields → skip, never cast — a bad size would otherwise
// pass a provider's maxFileBytes comparison and dead-letter the consumer.
// Shared by fileRef.created (the entity fields directly) and fileRef.restored
// (the same fields nested under `previous`, the soft-deleted snapshot).
const fileRefIngestFieldsSchema = z.object({
  storageKey: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().min(0),
});
type FileRefIngestFields = z.infer<typeof fileRefIngestFieldsSchema>;

// Shared by fileRef.created and fileRef.restored — a restored fileRef goes
// through the same provider routing/skip logic as a fresh upload, so a
// delete→restore round-trip re-requests ingest instead of leaving the file
// without an extract.
async function requestIngestForFileRef(
  event: { readonly aggregateId: string },
  fileRef: FileRefIngestFields,
  ctx: MspApplyContext,
): Promise<void> {
  const skip = (reason: "file-too-large" | "unsupported-mime-type") =>
    ctx.unsafeAppendEvent({
      aggregateId: event.aggregateId,
      aggregateType: DOCUMENT_INGEST_AGGREGATE_TYPE,
      type: DOCUMENT_INGEST_SKIPPED_EVENT_QN,
      payload: {
        fileRefId: event.aggregateId,
        storageKey: fileRef.storageKey,
        fileName: fileRef.fileName,
        mimeType: fileRef.mimeType,
        size: fileRef.size,
        reason,
      },
    });

  // Boot already refused an invalid/conflicting provider config — a
  // throw here can only mean the registry changed since then, handled
  // like any other apply throw (retry/dead-letter).
  const providers = resolveDocumentIngestProviders(
    ctx.registry.getExtensionUsages(EXT_DOCUMENT_INGEST_PROVIDER),
  );
  const provider = providers.get(normalizeMimeType(fileRef.mimeType));
  // skip: no provider claims this mimeType — no ingest requested
  if (!provider) {
    await skip("unsupported-mime-type");
    return;
  }
  // skip: over the winning provider's own cap — no ingest requested,
  // upload itself already succeeded
  if (fileRef.size > provider.maxFileBytes) {
    await skip("file-too-large");
    return;
  }

  await ctx.unsafeAppendEvent({
    aggregateId: event.aggregateId,
    aggregateType: DOCUMENT_INGEST_AGGREGATE_TYPE,
    type: DOCUMENT_INGEST_REQUESTED_EVENT_QN,
    payload: {
      fileRefId: event.aggregateId,
      storageKey: fileRef.storageKey,
      fileName: fileRef.fileName,
      mimeType: fileRef.mimeType,
      size: fileRef.size,
      provider: provider.name,
    },
  });
}

export const documentIngestFoundationFeature = defineFeature(FEATURE_NAME, (r) => {
  r.describe(
    "Shared PDF/Scan/Image → normalized-text ingest primitive. Owns the `documentExtract` entity (fileRefId, storageKey, per-page text + metadata) as an implicit entity-projection, the per-tenant `ocrLanguage`/`maxPagesPerFile` config keys, the `documentIngestProvider` extension-point providers register accepted mimeTypes/size caps under, and a fileRef.created/fileRef.restored trigger that resolves the provider for a file's mimeType and requests ingest via `documentIngest.requested` tagged with the winning provider — a delete→restore round-trip re-requests ingest the same way a fresh upload does.",
  );
  r.uiHints({
    displayLabel: "Document Ingest Foundation",
    category: "storage",
    recommended: false,
  });
  // tenant-lifecycle hosts EXT_TENANT_DATA — documentExtract.pages is
  // tenant-subject ciphertext and needs the destroy hook below.
  r.requires("config", "tenant-lifecycle");

  r.entity("documentExtract", documentExtractEntity);
  r.useExtension(EXT_TENANT_DATA, "documentExtract", {
    destroy: documentExtractTenantDestroyHook,
  });

  // No onRegister: resolution happens at boot and per-apply, not on register.
  r.extendsRegistrar(EXT_DOCUMENT_INGEST_PROVIDER, {});
  r.bootCheck(({ features }) => validateDocumentIngestProviderWiring(features));

  const ocrLanguageConfigKey = r.config(
    "ocrLanguage",
    createTenantConfig("text", {
      default: "deu+eng",
      // Tesseract -l argument syntax: one or more 3-letter language codes
      // joined by "+" (e.g. "deu+eng"). Unconstrained free text here would
      // reach the OCR provider call unvalidated (#1501).
      pattern: { regex: "^[a-z]{3}(\\+[a-z]{3})*$" },
      write: access.roles("TenantAdmin", "SystemAdmin"),
      read: access.roles("TenantAdmin", "SystemAdmin", "User"),
    }),
  );
  const maxPagesPerFileConfigKey = r.config(
    "maxPagesPerFile",
    createTenantConfig("number", {
      default: 50,
      // Without a bound a tenant could set 0 (silently kills ingest) or an
      // unbounded value (OCR worker runs per-file for as long as the PDF
      // has pages — job-queue starvation) (#1501).
      bounds: { min: 1, max: 500 },
      write: access.roles("TenantAdmin", "SystemAdmin"),
      read: access.roles("TenantAdmin", "SystemAdmin", "User"),
    }),
  );

  // "fileName" can carry a real person's name; the payload has no user-subject
  // field to encrypt it under, so piiFields stays "none" for now.
  r.defineEvent(DOCUMENT_INGEST_REQUESTED_EVENT_SHORT, documentIngestRequestedPayloadSchema, {
    piiFields: "none",
    version: 2,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        // "unknown" can never match a real where.provider filter — an
        // upcast v1 row reads as unclaimed instead of silently misrouting to
        // whichever provider happens to be mounted today.
        transform: { default: { provider: "unknown" } },
      },
    ],
  });
  r.defineEvent(DOCUMENT_INGEST_SKIPPED_EVENT_SHORT, documentIngestSkippedPayloadSchema, {
    piiFields: "none",
  });

  r.multiStreamProjection({
    name: "request-ingest",
    apply: {
      [FILE_REF_CREATED]: async (event, _tx, ctx) => {
        // entity-event payloads are generic Record<string, unknown> — parse
        // at the MSP boundary (same pattern as storage-tracking's readNumber).
        const parsed = fileRefIngestFieldsSchema.safeParse(event.payload);
        // skip: malformed / incomplete payload — don't poison the consumer
        if (!parsed.success) return;
        await requestIngestForFileRef(event, parsed.data, ctx);
      },
      [FILE_REF_RESTORED]: async (event, _tx, ctx) => {
        // fileRef.restored carries { previous }, the pre-restore soft-deleted
        // row (event-store-executor-write.ts restore()) — same field shape
        // as fileRef.created's payload.
        const parsed = fileRefIngestFieldsSchema.safeParse(event.payload["previous"]);
        // skip: malformed / incomplete previous snapshot — don't poison the consumer
        if (!parsed.success) return;
        await requestIngestForFileRef(event, parsed.data, ctx);
      },
    },
  });

  // fileRef delete/forget cleanup: documentExtract rows are derived data —
  // once the source file is gone (soft-deleted or Art.17-forgotten), the
  // extracted text has no reason to survive it either.
  r.multiStreamProjection({
    name: "forget-extract-with-file-ref",
    apply: {
      [FILE_REF_DELETED]: forgetExtractOnFileRefDeletedHook,
      [FILE_REF_FORGOTTEN]: forgetExtractOnFileRefForgottenHook,
    },
  });

  return { ocrLanguageConfigKey, maxPagesPerFileConfigKey };
});
