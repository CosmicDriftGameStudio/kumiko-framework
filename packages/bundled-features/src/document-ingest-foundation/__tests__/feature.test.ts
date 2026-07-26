// feature.ts contract tests — pin the public surface of the Phase-1
// document-ingest-foundation skeleton: entity, tenant-config, the
// fileRef.created MSP, and the documentIngest.requested event it defines.
// End-to-end MSP behavior (mime/size validation, event payload) is covered
// by feature.integration.test.ts.

import { describe, expect, test } from "bun:test";
import { documentExtractEntity } from "../entity";
import { DOCUMENT_INGEST_REQUESTED_EVENT_QN } from "../events";
import { documentIngestFoundationFeature } from "../feature";

describe("documentIngestFoundationFeature — shape", () => {
  test("has the expected name", () => {
    expect(documentIngestFoundationFeature.name).toBe("document-ingest-foundation");
  });

  test("declares config as a hard requirement (tenant-config keys live there)", () => {
    expect(documentIngestFoundationFeature.requires).toContain("config");
  });

  test("registers the documentExtract entity as an implicit projection", () => {
    expect(Object.keys(documentIngestFoundationFeature.entities ?? {})).toEqual([
      "documentExtract",
    ]);
  });

  test("documentExtract entity pins table name, field set, and pages encryption (#1501)", () => {
    expect(documentExtractEntity.table).toBe("read_document_extracts");
    expect(Object.keys(documentExtractEntity.fields)).toEqual([
      "fileRefId",
      "storageKey",
      "pages",
      "meta",
    ]);
    expect(documentExtractEntity.fields.pages).toMatchObject({
      type: "longText",
      encrypted: true,
    });
    expect(documentExtractEntity.fields.meta).toMatchObject({ type: "jsonb" });
  });

  test("exports writeIngestPages / readIngestPages for the encrypted pages wire format (#1549)", async () => {
    const { readIngestPages, writeIngestPages } = await import("../pages");
    const pages = [{ pageNumber: 1, text: "x" }];
    expect(readIngestPages(writeIngestPages(pages))).toEqual(pages);
  });

  test("registers NO write/query handlers — only entity, config, event, and MSP", () => {
    expect(Object.keys(documentIngestFoundationFeature.writeHandlers)).toHaveLength(0);
    expect(Object.keys(documentIngestFoundationFeature.queryHandlers)).toHaveLength(0);
  });

  test("registers the documentIngest.requested event under the exported QN", () => {
    expect(Object.keys(documentIngestFoundationFeature.events)).toEqual([
      "documentIngest.requested",
    ]);
    // The registry qualifies short → QN via qn(toKebab(feature), "event",
    // toKebab(short)) — pin the hand-written DOCUMENT_INGEST_REQUESTED_EVENT_QN
    // against what defineEvent actually registered, so a feature/short-name
    // rename can't silently drift the two apart (kumiko-framework#1497: a
    // stale QN fails MSP-apply at runtime with "event not registered", not
    // at compile time).
    expect(documentIngestFoundationFeature.events["documentIngest.requested"]?.name).toBe(
      DOCUMENT_INGEST_REQUESTED_EVENT_QN,
    );
  });

  test("registers the fileRef.created MSP", () => {
    expect(Object.keys(documentIngestFoundationFeature.multiStreamProjections)).toEqual([
      "request-ingest",
    ]);
    const msp = documentIngestFoundationFeature.multiStreamProjections["request-ingest"];
    expect(Object.keys(msp?.apply ?? {})).toEqual(["fileRef.created"]);
  });
});

describe("documentIngestFoundationFeature.exports — typed config handles", () => {
  test("exposes ocrLanguage with the deu+eng default", () => {
    const key = documentIngestFoundationFeature.exports.ocrLanguageConfigKey;
    expect(key.name).toBe("document-ingest-foundation:config:ocr-language");
    expect(documentIngestFoundationFeature.configKeys["ocrLanguage"]?.default).toBe("deu+eng");
  });

  test("exposes maxPagesPerFile with the 50-page default", () => {
    const key = documentIngestFoundationFeature.exports.maxPagesPerFileConfigKey;
    expect(key.name).toBe("document-ingest-foundation:config:max-pages-per-file");
    expect(documentIngestFoundationFeature.configKeys["maxPagesPerFile"]?.default).toBe(50);
  });

  test("ocrLanguage rejects a value that isn't a Tesseract -l argument (#1501)", () => {
    const pattern = documentIngestFoundationFeature.configKeys["ocrLanguage"]?.pattern;
    expect(pattern).toBeDefined();
    const re = new RegExp(pattern!.regex, pattern!.flags);
    expect(re.test("deu+eng")).toBe(true);
    expect(re.test("eng")).toBe(true);
    expect(re.test("")).toBe(false);
    expect(re.test("EU")).toBe(false);
    expect(re.test("rm -rf /")).toBe(false);
  });

  test("maxPagesPerFile is bounded so a tenant can't disable or unbound the cap (#1501)", () => {
    const bounds = documentIngestFoundationFeature.configKeys["maxPagesPerFile"]?.bounds;
    expect(bounds).toEqual({ min: 1, max: 500 });
  });
});
