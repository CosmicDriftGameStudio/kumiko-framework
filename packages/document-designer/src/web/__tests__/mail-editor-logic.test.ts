import { describe, expect, test } from "bun:test";
import {
  mailSaveFlags,
  placeholderNames,
  previewPayload,
  railValidationOf,
  resourcePreviewsOfMail,
  testMailPayload,
} from "../mail-editor-logic.ts";
import type { MailDraft, MailValidation, TemplateRowView } from "../mail-types.ts";

const t = (key: string, params?: Readonly<Record<string, unknown>>): string =>
  `${key}|${JSON.stringify(params ?? {})}`;

const validation: MailValidation = {
  canSave: true,
  canPublish: true,
  issues: [],
  publishIssues: [],
  used: [],
  unknown: [],
  missingRequired: ["customer.name"],
  warnings: [],
  variables: {
    customer: { type: "text" },
    items: { type: "list", item: { sku: { type: "text" }, price: { type: "money" } } },
  },
  systemPlaceholders: ["brand.name", "customer"],
};

const draft: MailDraft = {
  subject: "Hello",
  previewText: "",
  layoutSlug: "default",
  category: "",
  senderName: "",
  replyTo: "",
  headerChip: "",
  tone: "",
  footerNote: "",
  body: "<p>Hi</p>",
};

const row = (status: string): TemplateRowView => ({
  id: "r1",
  version: 1,
  slug: "s",
  locale: "en",
  scope: "tenant",
  status,
  content: "",
  variableSchema: {},
  linkedResources: {},
  meta: {},
  modifiedAt: null,
});

describe("placeholderNames", () => {
  test("is empty without a validation", () => {
    expect(placeholderNames(null)).toEqual([]);
  });

  test("lists variables, dotted list columns and system placeholders once each", () => {
    expect(placeholderNames(validation)).toEqual([
      "customer",
      "items",
      "items.sku",
      "items.price",
      "brand.name",
    ]);
  });
});

describe("mailSaveFlags", () => {
  const base = {
    locked: false,
    busy: false,
    validation,
    dirty: true,
    creating: false,
    row: row("active"),
  };

  test("saves unsaved edits and the first save of a new language", () => {
    expect(mailSaveFlags(base).canSave).toBe(true);
    expect(mailSaveFlags({ ...base, dirty: false }).canSave).toBe(false);
    expect(mailSaveFlags({ ...base, dirty: false, creating: true }).canSave).toBe(true);
  });

  test("a locked or busy editor can do nothing", () => {
    expect(mailSaveFlags({ ...base, locked: true })).toEqual({ canSave: false, canPublish: false });
    expect(mailSaveFlags({ ...base, busy: true })).toEqual({ canSave: false, canPublish: false });
  });

  test("a failing validation blocks saving and publishing", () => {
    const blocked = mailSaveFlags({
      ...base,
      validation: { ...validation, canSave: false, canPublish: false },
    });
    expect(blocked).toEqual({ canSave: false, canPublish: false });
    expect(mailSaveFlags({ ...base, validation: null })).toEqual({
      canSave: false,
      canPublish: false,
    });
  });

  test("a clean active row has nothing to publish, a clean draft row does", () => {
    const clean = { ...base, dirty: false };
    expect(mailSaveFlags(clean).canPublish).toBe(false);
    expect(mailSaveFlags({ ...clean, row: row("draft") }).canPublish).toBe(true);
    expect(mailSaveFlags({ ...clean, row: null }).canPublish).toBe(true);
  });
});

describe("resourcePreviewsOfMail", () => {
  test("previews images only and puts the size token into the caption", () => {
    const previews = resourcePreviewsOfMail(
      [
        { kind: "image", key: "logo", fileRefId: "file-1" },
        { kind: "file", key: "terms", fileRefId: "file-2", fileName: "terms.pdf" },
        { kind: "pdf", key: "invoice", templateSlug: "inv", fileName: "inv.pdf" },
      ],
      t,
    );
    expect(Object.keys(previews)).toEqual(["logo"]);
    expect(previews["logo"]?.src).toContain("file-1");
    expect(previews["logo"]?.caption).toContain('"size":"{size}"');
    expect(previews["logo"]?.caption).toContain('"key":"logo"');
  });
});

describe("railValidationOf", () => {
  test("keeps the validation of an open language", () => {
    expect(railValidationOf(false, validation)).toBe(validation);
  });

  test("clears missing placeholders in a language that is not written yet", () => {
    const rail = railValidationOf(true, validation);
    expect(rail?.missingRequired).toEqual([]);
    expect(rail?.variables).toBe(validation.variables);
  });

  test("passes a missing validation through as null", () => {
    expect(railValidationOf(true, null)).toBeNull();
    expect(railValidationOf(false, null)).toBeNull();
  });
});

describe("test mail and preview payloads", () => {
  const common = { slug: "s", locale: "en", variableSchema: { a: 1 } };

  test("the test mail carries the draft body, meta and the chosen options", () => {
    const payload = testMailPayload({
      ...common,
      draft,
      includeAttachments: true,
      prefixSubject: false,
      pickedVariables: null,
    });
    expect(payload).toEqual({
      slug: "s",
      locale: "en",
      content: "<p>Hi</p>",
      meta: { subject: "Hello", layoutSlug: "default" },
      variableSchema: { a: 1 },
      includeAttachments: true,
      prefixSubject: false,
    });
  });

  test("picked variables are sent only when a record was picked", () => {
    const picked = { customer: "Ada" };
    expect(
      testMailPayload({
        ...common,
        draft,
        includeAttachments: false,
        prefixSubject: true,
        pickedVariables: picked,
      }).variables,
    ).toEqual(picked);
    expect(
      previewPayload({ ...common, settled: draft, pickedVariables: picked }).variables,
    ).toEqual(picked);
    expect(
      "variables" in previewPayload({ ...common, settled: draft, pickedVariables: null }),
    ).toBe(false);
  });

  test("the preview is always rendered as a mail from the settled draft", () => {
    expect(previewPayload({ ...common, settled: draft, pickedVariables: null })).toMatchObject({
      kind: "mail",
      content: "<p>Hi</p>",
    });
  });
});
