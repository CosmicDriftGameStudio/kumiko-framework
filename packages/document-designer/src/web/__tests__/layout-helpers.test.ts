import { describe, expect, test } from "bun:test";
import { EMPTY_VALUE_PLACEHOLDER } from "@cosmicdrift/kumiko-renderer/headless";
import { composeLayoutHtml } from "../compose-layout.ts";
import { parseOverviewRow } from "../overview-row.ts";
import { templateTitle, usedByLabel } from "../used-by-label.ts";

const messages: Readonly<Record<string, string>> = {
  "documentDesigner.usedBy.allMails": "all mails",
  "documentDesigner.usedBy.allPdfs": "all PDFs",
  "documentDesigner.usedBy.templates": "{count} templates",
  "billing:feature.label": "Invoices",
  "billing:notify.invoice-issued.label": "Invoice issued",
};

// Mirrors the renderer: an unknown key comes back unchanged.
function t(key: string, params?: Readonly<Record<string, unknown>>): string {
  const message = messages[key];
  if (message === undefined) return key;
  return message.replace("{count}", String(params?.["count"]));
}

const baseRow = {
  id: "mail|billing:notify:invoice-issued",
  title: "Invoice sent",
  slug: "billing:notify:invoice-issued",
  kind: "mail",
  origin: "tenant",
  locales: ["de"],
  status: "draft",
  version: 4,
  modifiedAt: "2026-10-01T10:00:00.000Z",
  usedBy: [],
  usedByCount: 0,
};

function viewOf(overrides: Record<string, unknown>) {
  const view = parseOverviewRow({ ...baseRow, ...overrides });
  if (view === null) throw new Error("row did not parse");
  return view;
}

describe("composeLayoutHtml", () => {
  test("always keeps the content slot and leaves empty regions out", () => {
    expect(composeLayoutHtml({ header: "", signature: "<p><br></p>", footer: "" })).toBe(
      "<div data-content></div>",
    );
  });

  test("wraps filled regions in the top-level divs the server reads", () => {
    expect(
      composeLayoutHtml({ header: "<p>H</p>", signature: "<p>S</p>", footer: "<p>F</p>" }),
    ).toBe(
      "<div data-header><p>H</p></div><div data-content></div><div data-signature><p>S</p></div><div data-footer><p>F</p></div>",
    );
  });
});

describe("usedByLabel", () => {
  test("the default layout applies to every mail or PDF", () => {
    expect(usedByLabel(t, viewOf({ kind: "mail-layout", slug: "default" }))).toBe("all mails");
    expect(usedByLabel(t, viewOf({ kind: "pdf-layout", slug: "default" }))).toBe("all PDFs");
  });

  test("a named layout counts the templates that use it", () => {
    expect(usedByLabel(t, viewOf({ kind: "mail-layout", slug: "dunning", usedByCount: 3 }))).toBe(
      "3 templates",
    );
    expect(usedByLabel(t, viewOf({ kind: "mail-layout", slug: "dunning", usedByCount: 0 }))).toBe(
      EMPTY_VALUE_PLACEHOLDER,
    );
  });

  test("a mail shows feature and notification, falling back to the raw names", () => {
    const translated = viewOf({
      usedBy: [{ feature: "billing", notification: "invoice-issued" }],
    });
    expect(usedByLabel(t, translated)).toBe("Invoices · Invoice issued");
    const untranslated = viewOf({ usedBy: [{ feature: "rental", notification: "reminder" }] });
    expect(usedByLabel(t, untranslated)).toBe("rental · reminder");
  });

  test("a PDF template without usage shows a dash", () => {
    expect(usedByLabel(t, viewOf({ kind: "document-pdf", slug: "billing:invoice" }))).toBe(
      EMPTY_VALUE_PLACEHOLDER,
    );
  });
});

describe("templateTitle", () => {
  test("a stored title wins over the notification label", () => {
    expect(templateTitle(t, viewOf({}))).toBe("Invoice sent");
  });

  test("a seeded mail without a title is named by its notification label, else by its slug", () => {
    expect(templateTitle(t, viewOf({ title: "billing:notify:invoice-issued" }))).toBe(
      "Invoice issued",
    );
    expect(
      templateTitle(t, viewOf({ title: "rental:notify:reminder", slug: "rental:notify:reminder" })),
    ).toBe("reminder");
    expect(
      templateTitle(
        t,
        viewOf({ kind: "document-pdf", title: "billing:invoice", slug: "billing:invoice" }),
      ),
    ).toBe("billing:invoice");
  });
});

describe("parseOverviewRow", () => {
  test("rejects rows with an unknown kind or status", () => {
    expect(parseOverviewRow({ ...baseRow, kind: "sms" })).toBeNull();
    expect(parseOverviewRow({ ...baseRow, status: "deleted" })).toBeNull();
  });

  test("keeps the layout slug and defaults a missing count to the usage length", () => {
    const view = viewOf({
      kind: "mail",
      layoutSlug: "dunning",
      usedByCount: undefined,
      usedBy: [{ feature: "a", notification: "b" }],
    });
    expect(view.layoutSlug).toBe("dunning");
    expect(view.usedByCount).toBe(1);
  });
});

describe("parseOverviewRow draft beside the served version", () => {
  test("an active row carries the number of its open draft", () => {
    const view = viewOf({ status: "active", version: 3, draftVersion: 5 });
    expect(view).toMatchObject({ status: "active", version: 3, draftVersion: 5 });
  });

  test("a row without a draft number has none", () => {
    expect(viewOf({ status: "active", version: 3 }).draftVersion).toBeNull();
  });
});
