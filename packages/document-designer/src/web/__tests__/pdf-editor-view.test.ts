import { describe, expect, test } from "bun:test";
import { type EditorState, snapshotOf } from "../pdf-editor-draft.ts";
import { buildPdfView } from "../pdf-editor-view.ts";
import { EMPTY_PDF_META } from "../pdf-meta.ts";
import type { TemplateDetail, ValidationResult } from "../types.ts";

const t = (key: string, params?: Readonly<Record<string, unknown>>): string =>
  params === undefined ? key : `${key}|${JSON.stringify(params)}`;

const draft = { content: "<p>a</p>", meta: EMPTY_PDF_META };
const current: EditorState = { key: "k", draft, settled: draft, snapshot: snapshotOf(draft) };

const validation: ValidationResult = {
  canSave: true,
  canPublish: true,
  issues: [],
  publishIssues: [],
  used: [],
  unknown: [],
  missingRequired: [],
  warnings: [],
  variables: {},
  systemPlaceholders: ["page.number"],
};

type StateOptions = {
  readonly layout?: { slug: string; html: string } | null;
  readonly validation?: ValidationResult | null | undefined;
  readonly status?: {
    error: unknown;
    loading: boolean;
    data?: { available: boolean; message?: string };
  };
  readonly logoFile?: string;
  readonly showOrigin?: boolean;
  readonly overrides?: {
    activeOverrides: number;
    draftOverrides: number;
    totalTenants: number | null;
  };
  readonly layoutRows?: Array<{ slug: string; title: string }>;
  readonly overviewRows?: Array<Record<string, unknown>>;
  readonly generated?: unknown;
};

function view(
  options: StateOptions = {},
  detail: Partial<TemplateDetail> = {},
  state: EditorState = current,
) {
  // Boundary cast: the view reads only these members of the editor state.
  const s = {
    server: {
      layout: options.layout === undefined ? null : options.layout,
      validation: "validation" in options ? options.validation : validation,
      statusQuery: options.status ?? { error: null, loading: false, data: { available: true } },
      brandingLogoFile: options.logoFile ?? "",
      showOrigin: options.showOrigin ?? false,
      overridesQuery: { data: options.overrides },
      layouts: { rows: options.layoutRows ?? [] },
    },
    ui: { generated: options.generated ?? null },
    host: { overview: { rows: options.overviewRows ?? [] } },
    vocabulary: {
      variables: {},
      variableNames: [],
      variableLabels: {},
      systemVariables: [],
    },
  } as unknown as Parameters<typeof buildPdfView>[0]["s"];
  const fullDetail = {
    scope: "tenant",
    version: 4,
    status: "active",
    linkedResources: null,
    ...detail,
  } as unknown as TemplateDetail;
  return buildPdfView({ t, s, slug: "invoice", current: state, detail: fullDetail });
}

describe("buildPdfView dirty and generated state", () => {
  test("is dirty once the draft differs from the saved snapshot", () => {
    expect(view().dirty).toBe(false);
    const edited = { ...current, draft: { ...draft, content: "<p>b</p>" } };
    expect(view({}, {}, edited).dirty).toBe(true);
  });

  test("a generated pdf is fresh only for the current draft", () => {
    expect(view({ generated: { forSnapshot: snapshotOf(draft), result: {} } }).generatedFresh).toBe(
      true,
    );
    expect(view({ generated: { forSnapshot: "old", result: {} } }).generatedFresh).toBe(false);
    expect(view().generatedFresh).toBe(false);
  });
});

describe("buildPdfView pdf service", () => {
  test("reports availability and the unavailable reason", () => {
    const up = view();
    expect(up.pdfAvailable).toBe(true);
    expect(up.pdfUnavailableNote).toBe(false);

    const down = view({
      status: { error: null, loading: false, data: { available: false, message: "No chrome" } },
    });
    expect(down.pdfAvailable).toBe(false);
    expect(down.unavailableMessage).toBe("No chrome");
    expect(down.pdfUnavailableNote).toBe(true);
  });

  test("stays quiet while the status is still loading", () => {
    const loading = view({ status: { error: null, loading: true } });
    expect(loading.pdfAvailable).toBe(false);
    expect(loading.pdfUnavailableNote).toBe(false);
  });

  test("a failed status query counts as unavailable", () => {
    expect(
      view({ status: { error: new Error("x"), loading: false, data: { available: true } } })
        .pdfAvailable,
    ).toBe(false);
  });
});

describe("buildPdfView layout", () => {
  test("names the layout by its title and falls back to the slug", () => {
    const named = view({
      layout: { slug: "letter", html: "" },
      layoutRows: [{ slug: "letter", title: "Letterhead" }],
    });
    expect(named.layoutName).toBe("Letterhead");
    expect(view({ layout: { slug: "unknown", html: "" } }).layoutName).toBe("unknown");
    expect(view({ layout: null }).layoutName).toBe("default");
  });

  test("fills a variable when the layout uses it as data attribute or placeholder", () => {
    const withLayout = view({
      layout: { slug: "default", html: '<div data-variable="logo"></div>{{page}}' },
    });
    expect(withLayout.layoutFills("logo")).toBe(true);
    expect(withLayout.layoutFills("page")).toBe(true);
    expect(withLayout.layoutFills("other")).toBe(false);
    expect(view({ layout: null }).layoutFills("logo")).toBe(false);
  });

  test("serves the branding logo only for the logo resource", () => {
    const branded = view({ logoFile: "file 1" });
    expect(branded.layoutResourceSrc("logo")).toBe("/api/files/file%201");
    expect(branded.layoutResourceSrc("other")).toBeUndefined();
    expect(view({ logoFile: "" }).layoutResourceSrc("logo")).toBeUndefined();
  });
});

describe("buildPdfView validation", () => {
  test("has no footer or placeholder source before validation", () => {
    const none = view({ validation: undefined });
    expect(none.footer).toBeNull();
    expect(none.placeholderSource).toBeNull();
    expect(none.canPublish).toBe(false);
    expect(view({ validation: null }).footer).toBeNull();
  });

  test("builds the footer and placeholder source from the validation", () => {
    const ready = view();
    expect(ready.canPublish).toBe(true);
    expect(ready.footer).not.toBeNull();
    expect(ready.placeholderSource?.systemPlaceholders).toEqual(["page.number"]);
  });
});

describe("buildPdfView origin text", () => {
  test("a system template with other tenants' overrides counts them", () => {
    const withTotal = view(
      {
        showOrigin: true,
        overrides: { activeOverrides: 2, draftOverrides: 1, totalTenants: 10 },
      },
      { scope: "system" },
    );
    expect(withTotal.showOverrideLinks).toBe(true);
    expect(withTotal.originText).toBe(
      'documentDesigner.originBar.withTotal|{"count":3,"total":10}',
    );

    const noTotal = view(
      {
        showOrigin: true,
        overrides: { activeOverrides: 0, draftOverrides: 0, totalTenants: null },
      },
      { scope: "system" },
    );
    expect(noTotal.originText).toBe('documentDesigner.originBar.noTotal|{"count":0}');
  });

  test("a system template without origin links shows its version", () => {
    const shown = view({}, { scope: "system" });
    expect(shown.showOverrideLinks).toBe(false);
    expect(shown.originText).toBe('documentDesigner.mail.origin.system|{"version":4}');
  });

  test("a tenant template names the system version it overrides, if any", () => {
    expect(view().originText).toBe("documentDesigner.mail.origin.tenantOnly");
    const overriding = view({
      overviewRows: [{ slug: "invoice", title: "Invoice", kind: "pdf", systemVersion: 7 }],
    });
    expect(overriding.originText).toBe('documentDesigner.mail.origin.overrides|{"version":7}');
    expect(overriding.systemVersion).toBe(7);
  });

  test("the title is the slug until the overview knows the template", () => {
    expect(view().title).toBe("invoice");
    expect(view({ overviewRows: [{ slug: "invoice", title: "Invoice", kind: "pdf" }] }).title).toBe(
      "Invoice",
    );
  });
});
