// feature.ts contract tests — pin the public surface of the
// document-ingest-foundation skeleton: entity, tenant-config, the
// fileRef.created MSP, and the documentIngest.requested event it defines.
// End-to-end MSP behavior (mime/size validation, event payload) is covered
// by feature.integration.test.ts.

import { describe, expect, test } from "bun:test";
import { EXT_TENANT_DATA } from "@cosmicdrift/kumiko-framework/engine";
import { documentExtractEntity } from "../entity.ts";
import {
  DOCUMENT_INGEST_PROGRESS_EVENT_QN,
  DOCUMENT_INGEST_REQUESTED_EVENT_QN,
  DOCUMENT_INGEST_SKIPPED_EVENT_QN,
} from "../events.ts";
import { createDocumentIngestFoundationFeature } from "../feature.ts";

describe("documentIngestFoundationFeature — shape", () => {
  test("has the expected name", () => {
    expect(createDocumentIngestFoundationFeature().name).toBe("document-ingest-foundation");
  });

  test("declares config as a hard requirement (tenant-config keys live there)", () => {
    expect(createDocumentIngestFoundationFeature().requires).toContain("config");
  });

  test("declares tenant-lifecycle as a hard requirement — it hosts EXT_TENANT_DATA", () => {
    expect(createDocumentIngestFoundationFeature().requires).toContain("tenant-lifecycle");
  });

  test("registers the documentExtract entity as an implicit projection", () => {
    expect(Object.keys(createDocumentIngestFoundationFeature().entities ?? {})).toEqual([
      "documentExtract",
    ]);
  });

  test("registers an entity-exact EXT_TENANT_DATA destroy hook", () => {
    const usage = createDocumentIngestFoundationFeature().extensionUsages.find(
      (u) => u.extensionName === EXT_TENANT_DATA && u.entityName === "documentExtract",
    );
    expect(typeof usage?.options?.["destroy"]).toBe("function");
  });

  test("documentExtract entity pins table name, field set, and pages subject-encryption", () => {
    expect(documentExtractEntity.table).toBe("read_document_extracts");
    expect(Object.keys(documentExtractEntity.fields)).toEqual([
      "fileRefId",
      "storageKey",
      "pages",
      "meta",
    ]);
    // tenantOwned, not `encrypted: true` — the master-key path shreds nothing.
    expect(documentExtractEntity.fields.pages).toMatchObject({
      type: "longText",
      tenantOwned: true,
    });
    expect(documentExtractEntity.fields.pages).not.toHaveProperty("encrypted");
    expect(documentExtractEntity.fields.meta).toMatchObject({ type: "jsonb" });
  });

  test("exports writeIngestPages / readIngestPages for the encrypted pages wire format", async () => {
    const { readIngestPages, writeIngestPages } = await import("../pages.ts");
    const pages = [{ pageNumber: 1, text: "x" }];
    expect(readIngestPages(writeIngestPages(pages))).toEqual(pages);
  });

  test("registers NO write/query handlers — only entity, config, event, and MSP", () => {
    expect(Object.keys(createDocumentIngestFoundationFeature().writeHandlers)).toHaveLength(0);
    expect(Object.keys(createDocumentIngestFoundationFeature().queryHandlers)).toHaveLength(0);
  });

  test("registers the documentIngest.requested and documentIngest.skipped events under their exported QNs", () => {
    expect(Object.keys(createDocumentIngestFoundationFeature().events)).toEqual([
      "documentIngest.requested",
      "documentIngest.skipped",
      "documentIngest.progress",
    ]);
    expect(createDocumentIngestFoundationFeature().events["documentIngest.progress"]?.name).toBe(
      DOCUMENT_INGEST_PROGRESS_EVENT_QN,
    );
    // The registry qualifies short → QN via qn(toKebab(feature), "event",
    // toKebab(short)) — pin the hand-written DOCUMENT_INGEST_REQUESTED_EVENT_QN
    // against what defineEvent actually registered, so a feature/short-name
    // rename can't silently drift the two apart (a stale QN fails MSP-apply at
    // runtime with "event not registered", not at compile time).
    expect(createDocumentIngestFoundationFeature().events["documentIngest.requested"]?.name).toBe(
      DOCUMENT_INGEST_REQUESTED_EVENT_QN,
    );
    expect(createDocumentIngestFoundationFeature().events["documentIngest.skipped"]?.name).toBe(
      DOCUMENT_INGEST_SKIPPED_EVENT_QN,
    );
  });

  test("registers the fileRef.created/restored MSP and the fileRef delete/forget + orphan-extract cleanup MSP", () => {
    expect(Object.keys(createDocumentIngestFoundationFeature().multiStreamProjections)).toEqual([
      "request-ingest",
      "forget-extract-with-file-ref",
    ]);
    const requestIngest =
      createDocumentIngestFoundationFeature().multiStreamProjections["request-ingest"];
    expect(Object.keys(requestIngest?.apply ?? {})).toEqual([
      "fileRef.created",
      "fileRef.restored",
    ]);
    const forgetExtract =
      createDocumentIngestFoundationFeature().multiStreamProjections[
        "forget-extract-with-file-ref"
      ];
    expect(Object.keys(forgetExtract?.apply ?? {})).toEqual([
      "fileRef.deleted",
      "fileRef.forgotten",
      "document-extract.created",
    ]);
  });

  test("registers the documentIngestProvider extension point", () => {
    expect(Object.keys(createDocumentIngestFoundationFeature().registrarExtensions)).toContain(
      "documentIngestProvider",
    );
  });
});

describe("documentIngestFoundationFeature.exports — typed config handles", () => {
  test("exposes ocrLanguage with the deu+eng default", () => {
    const key = createDocumentIngestFoundationFeature().exports.ocrLanguageConfigKey;
    expect(key.name).toBe("document-ingest-foundation:config:ocr-language");
    expect(createDocumentIngestFoundationFeature().configKeys["ocrLanguage"]?.default).toBe(
      "deu+eng",
    );
  });

  test("exposes maxPagesPerFile with the 50-page default", () => {
    const key = createDocumentIngestFoundationFeature().exports.maxPagesPerFileConfigKey;
    expect(key.name).toBe("document-ingest-foundation:config:max-pages-per-file");
    expect(createDocumentIngestFoundationFeature().configKeys["maxPagesPerFile"]?.default).toBe(50);
  });

  test("ocrLanguage rejects a value that isn't a Tesseract -l argument", () => {
    const pattern = createDocumentIngestFoundationFeature().configKeys["ocrLanguage"]?.pattern;
    expect(pattern).toBeDefined();
    const re = new RegExp(pattern!.regex, pattern!.flags);
    expect(re.test("deu+eng")).toBe(true);
    expect(re.test("eng")).toBe(true);
    expect(re.test("")).toBe(false);
    expect(re.test("EU")).toBe(false);
    expect(re.test("rm -rf /")).toBe(false);
  });

  test("maxPagesPerFile is bounded so a tenant can't disable or unbound the cap", () => {
    const bounds = createDocumentIngestFoundationFeature().configKeys["maxPagesPerFile"]?.bounds;
    expect(bounds).toEqual({ min: 1, max: 500 });
  });
});
