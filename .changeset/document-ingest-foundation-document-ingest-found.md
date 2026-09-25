---
"@cosmicdrift/kumiko-bundled-features": minor
---

document-ingest-foundation is provider-driven; ALLOWED_MIME_TYPES/MAX_FILE_BYTES are gone

<!-- kumiko-changes
feature: document-ingest-foundation
type: breaking
title: document-ingest-foundation is provider-driven; ALLOWED_MIME_TYPES/MAX_FILE_BYTES are gone
migration: |
  The hardcoded MIME allowlist and fixed size cap are removed. A provider feature (e.g. kumiko-enterprise's LiteParse) now registers via r.useExtension(EXT_DOCUMENT_INGEST_PROVIDER, "<name>", { mimeTypes, maxFileBytes }) and routes its r.job's trigger through documentIngestProviderTrigger("<name>") instead of a bare { on: DOCUMENT_INGEST_REQUESTED_EVENT_QN }. A provider feature must also declare r.requires("document-ingest-foundation") — validateBoot rejects r.useExtension(EXT_DOCUMENT_INGEST_PROVIDER, ...) without it as a missing feature dependency. Boot now throws if: two providers claim the same mimeType, a job triggers on documentIngest.requested without a provider filter, a job filters to an unregistered provider name, or a registered provider has no job wired to it. documentIngest.requested's payload gained a required provider field (event schema version 2; a migration upcasts existing v1 events to provider: "unknown", a sentinel that cannot match any real provider filter). A file whose mimeType has no registered provider now appends documentIngest.skipped with reason unsupported-mime-type instead of file-too-large. A fileRef.deleted or fileRef.forgotten event now forgets that fileRef's documentExtract row (new forget-extract-with-file-ref table-less MSP) — previously the extract silently outlived a deleted/forgotten source file. Mounting documentIngestFoundationFeature with zero providers is valid: every upload is simply skipped as unsupported-mime-type. Boot only fails for a misconfigured wiring (unfiltered job on documentIngest.requested, a job filtered to an unregistered provider name, two providers claiming the same mimeType, or a registered provider with no job wired to it).
-->
