// feature.ts contract tests — pin the public surface of the Phase-1
// document-ingest-foundation skeleton (entity + tenant-config only).
// Provider wiring (fileRef.created trigger) is tested in its own feature
// (kumiko-framework#1497).

import { describe, expect, test } from "bun:test";
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

  test("registers NO write/query handlers yet — read-path lands with the trigger feature", () => {
    expect(Object.keys(documentIngestFoundationFeature.writeHandlers)).toHaveLength(0);
    expect(Object.keys(documentIngestFoundationFeature.queryHandlers)).toHaveLength(0);
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
