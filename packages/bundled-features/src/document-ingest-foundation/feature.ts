// kumiko-feature-version: 1
//
// document-ingest-foundation — Phase-1 (MVP) skeleton for the shared
// PDF/Scan/Image → normalized-text ingest primitive. Owns the
// `documentExtract` entity + tenant-config, and (Theme A, kumiko-framework
// #1497) the fileRef.created trigger: a multiStreamProjection that validates
// mime/size and — on OK — appends `documentIngest.requested`, the anchor
// event the Phase-2 worker job (kumiko-enterprise LiteParse provider) reacts
// to (event-trigger, not job-trigger — `files` exports no write-handler ref
// for r.job's trigger.on to hang off, files-post-processing recipe pattern).
// LiteParse itself lands in kumiko-enterprise#273-275. See
// CosmicDriftGameStudio/kumiko-framework#1495 for the full phase breakdown.

import { entityEventName } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createTenantConfig,
  defineFeature,
  EXT_TENANT_DATA,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { documentExtractEntity } from "./entity";
import {
  DOCUMENT_INGEST_AGGREGATE_TYPE,
  DOCUMENT_INGEST_REQUESTED_EVENT_QN,
  DOCUMENT_INGEST_REQUESTED_EVENT_SHORT,
  documentIngestRequestedPayloadSchema,
} from "./events";
import { documentExtractTenantDestroyHook } from "./tenant-destroy-hook";

const FEATURE_NAME = "document-ingest-foundation";

const FILE_REF_CREATED = entityEventName("fileRef", "created");

// Phase-1 scope (plan doc): PDF + raster images only. xlsx/docx/vision are
// Phase 2, routed through separate providers, not this MSP.
const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/tiff"]);

// ponytail: fixed cap, not tenant-config — the plan only calls out
// maxPagesPerFile as tenant-configurable. Runs BEFORE the mime check for
// the same reason it must run before isComplex() downstream: rejecting on
// size is O(1), the checks after it are not (Spike: 699-page PDF). Chosen
// on domain grounds — scanned invoices and official letters routinely land
// in the 10-20mb range, well above file-routes.ts' unconstrained-upload
// default (10mb); tests raise maxUploadSize instead of shrinking this.
const MAX_FILE_BYTES = 25 * 1024 * 1024;

// Narrow fileRef.created's generic entity payload at the MSP boundary.
// Missing/invalid fields → skip (return), never cast — a bad size would
// otherwise pass `undefined > MAX_FILE_BYTES` and a later appendDomainEvent
// schema failure would dead the request-ingest consumer for all tenants.
const fileRefCreatedPayloadSchema = z.object({
  storageKey: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().min(0),
});

export const documentIngestFoundationFeature = defineFeature(FEATURE_NAME, (r) => {
  r.describe(
    "Shared PDF/Scan/Image → normalized-text ingest primitive. Owns the `documentExtract` entity (fileRefId, storageKey, per-page text + metadata) as an implicit entity-projection, the per-tenant `ocrLanguage`/`maxPagesPerFile` config keys, and a fileRef.created trigger that validates mime/size and requests ingest via `documentIngest.requested`. LiteParse provider wiring lands in follow-up features.",
  );
  r.uiHints({
    displayLabel: "Document Ingest Foundation",
    category: "storage",
    recommended: false,
  });
  // tenant-lifecycle hosts EXT_TENANT_DATA — documentExtract.pages is
  // tenant-subject ciphertext and needs the destroy hook below (#1621).
  r.requires("config", "tenant-lifecycle");

  r.entity("documentExtract", documentExtractEntity);
  r.useExtension(EXT_TENANT_DATA, "documentExtract", {
    destroy: documentExtractTenantDestroyHook,
  });

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

  r.defineEvent(DOCUMENT_INGEST_REQUESTED_EVENT_SHORT, documentIngestRequestedPayloadSchema);

  r.multiStreamProjection({
    name: "request-ingest",
    apply: {
      [FILE_REF_CREATED]: async (event, _tx, ctx) => {
        // entity-event payloads are generic Record<string, unknown> — parse
        // at the MSP boundary (same pattern as storage-tracking's readNumber).
        const parsed = fileRefCreatedPayloadSchema.safeParse(event.payload);
        // skip: malformed / incomplete payload — don't poison the consumer
        if (!parsed.success) return;
        const payload = parsed.data;

        // skip: over the fixed cap — no ingest requested, upload itself already succeeded
        if (payload.size > MAX_FILE_BYTES) return;
        // skip: outside the Phase-1 mime allowlist — no ingest requested
        if (!ALLOWED_MIME_TYPES.has(payload.mimeType)) return;

        await ctx.unsafeAppendEvent({
          aggregateId: event.aggregateId,
          aggregateType: DOCUMENT_INGEST_AGGREGATE_TYPE,
          type: DOCUMENT_INGEST_REQUESTED_EVENT_QN,
          payload: {
            fileRefId: event.aggregateId,
            storageKey: payload.storageKey,
            fileName: payload.fileName,
            mimeType: payload.mimeType,
            size: payload.size,
          },
        });
      },
    },
  });

  return { ocrLanguageConfigKey, maxPagesPerFileConfigKey };
});
