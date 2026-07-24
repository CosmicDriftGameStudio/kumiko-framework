// kumiko-feature-version: 1
//
// document-ingest-foundation — Phase-1 (MVP) skeleton for the shared
// PDF/Scan/Image → normalized-text ingest primitive. This theme (A) only
// owns the `documentExtract` entity + its two tenant-config keys; the
// fileRef.created trigger + provider wiring land in kumiko-framework#1497,
// LiteParse in kumiko-enterprise#273-275. See CosmicDriftGameStudio/
// kumiko-framework#1495 for the full phase breakdown.

import { access, createTenantConfig, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { documentExtractEntity } from "./entity";

const FEATURE_NAME = "document-ingest-foundation";

export const documentIngestFoundationFeature = defineFeature(FEATURE_NAME, (r) => {
  r.describe(
    "Shared PDF/Scan/Image → normalized-text ingest primitive. Owns the `documentExtract` entity (fileRefId, storageKey, per-page text + metadata) as an implicit entity-projection, and the per-tenant `ocrLanguage`/`maxPagesPerFile` config keys consumed by the ingest provider. Provider wiring (fileRef.created trigger, LiteParse) lands in follow-up features.",
  );
  r.uiHints({
    displayLabel: "Document Ingest Foundation",
    category: "storage",
    recommended: false,
  });
  r.requires("config");

  r.entity("documentExtract", documentExtractEntity);

  const ocrLanguageConfigKey = r.config(
    "ocrLanguage",
    createTenantConfig("text", {
      default: "deu+eng",
      write: access.roles("TenantAdmin", "SystemAdmin"),
      read: access.roles("TenantAdmin", "SystemAdmin", "User"),
    }),
  );
  const maxPagesPerFileConfigKey = r.config(
    "maxPagesPerFile",
    createTenantConfig("number", {
      default: 50,
      write: access.roles("TenantAdmin", "SystemAdmin"),
      read: access.roles("TenantAdmin", "SystemAdmin", "User"),
    }),
  );

  return { ocrLanguageConfigKey, maxPagesPerFileConfigKey };
});
