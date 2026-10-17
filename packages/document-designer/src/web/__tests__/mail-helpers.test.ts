import { describe, expect, test } from "bun:test";
import {
  buildMeta,
  isDraftDirty,
  loadedMailOf,
  parseLinkedResources,
  uniqueResourceKey,
  variableLabelMap,
} from "../mail-draft.js";
import { footerMessage } from "../mail-footer.js";
import type { MailValidation, TemplateRowView } from "../mail-types.js";

const t = (key: string, params?: Readonly<Record<string, unknown>>): string =>
  `${key}${params === undefined ? "" : JSON.stringify(params)}`;

const row: TemplateRowView = {
  id: "t-1",
  version: 2,
  slug: "billing:notify:invoice-issued",
  locale: "de",
  scope: "tenant",
  status: "draft",
  content: "<p>Hi</p>",
  variableSchema: "{}",
  linkedResources: "{}",
  meta: JSON.stringify({
    subject: "S",
    previewText: "P",
    layoutSlug: "brand",
    senderName: "Nordlicht",
    replyTo: "buchhaltung@example.org",
    headerChip: "{{eventLabel}}",
    tone: "{{tone}}",
    footerNote: "Du erhältst diese Mail, weil du den Status abonniert hast.",
  }),
  modifiedAt: null,
};

describe("mail draft", () => {
  test("loads subject, preview text, layout and body", () => {
    expect(loadedMailOf(row)).toEqual({
      subject: "S",
      previewText: "P",
      layoutSlug: "brand",
      category: "",
      senderName: "Nordlicht",
      replyTo: "buchhaltung@example.org",
      headerChip: "{{eventLabel}}",
      tone: "{{tone}}",
      footerNote: "Du erhältst diese Mail, weil du den Status abonniert hast.",
      body: "<p>Hi</p>",
    });
  });

  test("meta leaves out empty optional fields", () => {
    const draft = loadedMailOf(row);
    expect(
      buildMeta({
        ...draft,
        previewText: "",
        layoutSlug: "",
        senderName: "",
        replyTo: "",
        headerChip: "",
        tone: "",
        footerNote: "",
      }),
    ).toEqual({ subject: "S" });
    expect(buildMeta({ ...draft, category: "marketing" })).toEqual({
      subject: "S",
      previewText: "P",
      layoutSlug: "brand",
      category: "marketing",
      senderName: "Nordlicht",
      replyTo: "buchhaltung@example.org",
      headerChip: "{{eventLabel}}",
      tone: "{{tone}}",
      footerNote: "Du erhältst diese Mail, weil du den Status abonniert hast.",
    });
  });

  test("dirty compares every field", () => {
    const draft = loadedMailOf(row);
    expect(isDraftDirty(draft, draft)).toBe(false);
    expect(isDraftDirty({ ...draft, body: "<p>x</p>" }, draft)).toBe(true);
    expect(isDraftDirty({ ...draft, category: "marketing" }, draft)).toBe(true);
    expect(isDraftDirty({ ...draft, senderName: "Other" }, draft)).toBe(true);
    expect(isDraftDirty({ ...draft, replyTo: "other@example.org" }, draft)).toBe(true);
    expect(isDraftDirty({ ...draft, tone: "success" }, draft)).toBe(true);
  });
});

describe("linked resources", () => {
  test("tells inline images, files and PDF links apart", () => {
    const parsed = parseLinkedResources(
      JSON.stringify({
        logo: "11111111-1111-4111-8111-111111111111",
        agb: { kind: "file", fileRefId: "f-1", fileName: "agb.pdf" },
        rechnung: {
          kind: "rendered-pdf",
          templateSlug: "billing:invoice",
          fileName: "r-{{nr}}.pdf",
        },
        broken: 7,
      }),
    );
    expect(parsed.map((entry) => entry.kind)).toEqual(["image", "file", "pdf"]);
  });

  test("keys are kebab-case without extension and unique", () => {
    expect(uniqueResourceKey("Logo Nordlicht.PNG", [])).toBe("logo-nordlicht");
    expect(uniqueResourceKey("logo.png", ["logo", "logo-2"])).toBe("logo-3");
    expect(uniqueResourceKey("äöü.png", [])).toBe("resource");
  });

  test("list item labels use the dotted form", () => {
    expect(
      variableLabelMap({
        lines: {
          type: "list",
          label: "Positionen",
          item: { description: { type: "text", label: "Text" } },
        },
      }),
    ).toEqual({ lines: "Positionen", "lines.description": "Text" });
  });
});

describe("footer message", () => {
  const base: MailValidation = {
    canSave: true,
    canPublish: true,
    issues: [],
    publishIssues: [],
    used: [],
    unknown: [],
    missingRequired: [],
    warnings: [],
    variables: { dueDate: { type: "date", label: "Fälligkeitsdatum", required: true } },
    systemPlaceholders: [],
  };

  test("names missing required placeholders by label, ahead of other issues", () => {
    const message = footerMessage(
      t,
      {
        ...base,
        missingRequired: ["dueDate"],
        issues: [{ path: "meta.subject", code: "empty", i18nKey: "x" }],
      },
      false,
    );
    expect(message.tone).toBe("bad");
    expect(message.text).toContain("Fälligkeitsdatum");
  });

  test("shows a warning when nothing blocks and ok otherwise", () => {
    expect(footerMessage(t, base, false).tone).toBe("ok");
    const warned = footerMessage(
      t,
      { ...base, warnings: [{ code: "resource_not_uploaded", detail: "logo", i18nKey: "k" }] },
      false,
    );
    expect(warned.tone).toBe("warn");
  });
});
