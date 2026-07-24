// feature.ts contract tests — pin the public surface of the Phase-1
// document-ingest-foundation skeleton: entity, tenant-config, the
// fileRef.created MSP, and the documentIngest.requested event it defines.
// End-to-end MSP behavior (mime/size validation, event payload) is covered
// by feature.integration.test.ts.

import { describe, expect, test } from "bun:test";
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
});
