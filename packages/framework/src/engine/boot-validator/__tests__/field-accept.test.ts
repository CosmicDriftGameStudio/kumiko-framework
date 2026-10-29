import { describe, expect, test } from "bun:test";
import { defineFeature } from "../../define-feature.ts";
import {
  createEmbeddedListField,
  createEntity,
  createFilesField,
  createImageField,
} from "../../factories.ts";
import { validateFieldConditions } from "../field-conditions.ts";

function featureWithImage(accept: readonly string[]) {
  return defineFeature("docs", (r) => {
    r.entity({
      name: "doc",
      ...createEntity({
        fields: { cover: createImageField({ accept, personal: false, reason: "x" }) },
      }),
    });
  });
}

function featureWithEmbeddedFiles(accept: readonly string[]) {
  return defineFeature("docs", (r) => {
    r.entity({
      name: "doc",
      ...createEntity({
        fields: { rows: createEmbeddedListField({ scans: { type: "files", accept } }) },
      }),
    });
  });
}

describe("validateFieldConditions — file accept entries", () => {
  test("bare lower-case extensions pass top-level and embedded", () => {
    expect(() => validateFieldConditions(featureWithImage(["png", "jpg"]))).not.toThrow();
    expect(() => validateFieldConditions(featureWithEmbeddedFiles(["pdf"]))).not.toThrow();
  });

  test.each([".pdf", "application/pdf", "image/*", "*", "PDF", ""])(
    "top-level accept entry %p is rejected with the correct form",
    (entry) => {
      expect(() => validateFieldConditions(featureWithImage([entry]))).toThrow(/accept/);
    },
  );

  test("the message names the offending entry and the corrected form", () => {
    expect(() => validateFieldConditions(featureWithImage([".pdf"]))).toThrow(
      /accept entry "\.pdf".*use "pdf" instead of "\.pdf" or "application\/pdf"/,
    );
  });

  test("embedded file sub-fields are checked too", () => {
    expect(() => validateFieldConditions(featureWithEmbeddedFiles(["application/pdf"]))).toThrow(
      /"rows" on entity "doc"\.scans has accept entry "application\/pdf"/,
    );
  });

  test("files fields are checked", () => {
    const feature = defineFeature("docs", (r) => {
      r.entity({
        name: "doc",
        ...createEntity({ fields: { attachments: createFilesField({ accept: ["*.pdf"] }) } }),
      });
    });
    expect(() => validateFieldConditions(feature)).toThrow(/accept entry "\*\.pdf"/);
  });
});
