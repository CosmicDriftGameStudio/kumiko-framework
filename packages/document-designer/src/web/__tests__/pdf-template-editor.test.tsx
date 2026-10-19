import { describe, expect, test } from "bun:test";
import {
  TemplateResolverHandlers,
  TemplateResolverQueries,
  textBlocksClient,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import {
  createStaticLocaleResolver,
  DispatcherProvider,
  kumikoDefaultTranslations,
  LocaleProvider,
  mergeTranslations,
  PrimitivesProvider,
  UserRolesProvider,
} from "@cosmicdrift/kumiko-renderer";
import type { Dispatcher } from "@cosmicdrift/kumiko-renderer/headless";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { RendererPuppeteerClientQueries } from "@cosmicdrift/kumiko-renderer-puppeteer-client/qualified-names";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { documentDesignerClient } from "../client-plugin.tsx";
import { PdfTemplateEditor } from "../pdf-template-editor.tsx";

const translations = mergeTranslations(
  mergeTranslations(kumikoDefaultTranslations, textBlocksClient().translations ?? {}),
  documentDesignerClient().translations ?? {},
);

type Call = { readonly type: string; readonly payload: unknown };

type FakeOptions = {
  readonly missingRequired?: readonly string[];
  readonly puppeteer: "available" | "unavailable" | "unknown-query";
};

const SLUG = "invoice";

function listRow(locale: string) {
  return {
    id: `row-${locale}`,
    tenantId: "system",
    slug: SLUG,
    kind: "document-pdf",
    locale,
    scope: "system",
    status: "active",
    contentFormat: "html",
    modifiedAt: "2026-10-16T08:00:00.000Z",
  };
}

function detailRow(locale: string) {
  return {
    ...listRow(locale),
    version: 3,
    content: "<p>Hello</p>",
    variableSchema: JSON.stringify({
      customer: { type: "text", label: "Customer", required: true },
    }),
    linkedResources: null,
    meta: JSON.stringify({ layoutSlug: "default" }),
    parentTemplateId: null,
  };
}

function validationFor(options: FakeOptions) {
  const missing = options.missingRequired ?? [];
  return {
    canSave: true,
    canPublish: missing.length === 0,
    issues: [],
    publishIssues: [],
    used: missing.includes("customer") ? [] : ["customer"],
    unknown: [],
    missingRequired: missing,
    warnings: [],
    variables: { customer: { type: "text", label: "Customer", required: true } },
    systemPlaceholders: ["page", "pages", "tenantName", "unsubscribeUrl"],
  };
}

function createFakeDispatcher(options: FakeOptions): { dispatcher: Dispatcher; writes: Call[] } {
  const writes: Call[] = [];
  const failure = {
    isSuccess: false,
    error: {
      code: "unknown_query",
      httpStatus: 404,
      i18nKey: "errors.unknown",
      message: "unknown query",
    },
  };
  const query = async (type: string, payload: unknown) => {
    switch (type) {
      case TemplateResolverQueries.list: {
        const kind = Reflect.get(Object(payload), "kind");
        return {
          isSuccess: true,
          data: kind === "pdf-layout" ? [] : [listRow("de"), listRow("en")],
        };
      }
      case TemplateResolverQueries.findById: {
        const id = String(Reflect.get(Object(payload), "id"));
        return { isSuccess: true, data: detailRow(id.replace("row-", "")) };
      }
      case TemplateResolverQueries.validate:
        return { isSuccess: true, data: validationFor(options) };
      case TemplateResolverQueries.tenantOverrides:
        return {
          isSuccess: true,
          data: {
            activeOverrides: 1,
            draftOverrides: 1,
            totalTenants: 12,
            diff: null,
            rows: [
              {
                tenantId: "t-4",
                tenantName: "Küstenwohnen Kiel GmbH",
                templateId: "o-1",
                locale: "de",
                status: "active",
                version: 2,
                changedAt: "2026-10-12T09:00:00.000Z",
                changedBy: "Anna Berger",
              },
              {
                tenantId: "t-5",
                tenantName: "Hansa Wohnbau eG",
                templateId: "o-2",
                locale: "de",
                status: "draft",
                version: 1,
                changedAt: "2026-10-13T09:00:00.000Z",
                changedBy: null,
              },
            ],
          },
        };
      case TemplateResolverQueries.usage:
        return { isSuccess: true, data: { usedBy: [] } };
      case TemplateResolverQueries.preview:
        return { isSuccess: true, data: { layout: null } };
      case RendererPuppeteerClientQueries.status:
        if (options.puppeteer === "unknown-query") return failure;
        return {
          isSuccess: true,
          data:
            options.puppeteer === "available"
              ? { available: true }
              : { available: false, error: "no_browser", message: "no browser" },
        };
      default:
        return failure;
    }
  };
  const write = async (type: string, payload: unknown) => {
    writes.push({ type, payload });
    return { isSuccess: true, data: { id: "saved", slug: SLUG, isNew: false } };
  };
  const dispatcher = {
    query,
    write,
    batch: async () => ({ isSuccess: true, data: [] }),
    statusStore: { getState: () => "online", subscribe: () => () => {} },
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  } as unknown as Dispatcher;
  return { dispatcher, writes };
}

function renderEditor(
  options: FakeOptions,
  onLocaleChange?: (locale: string) => void,
  roles: readonly string[] = ["TenantAdmin"],
) {
  const fake = createFakeDispatcher(options);
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[translations]}
    >
      <DispatcherProvider dispatcher={fake.dispatcher}>
        <UserRolesProvider roles={roles}>
          <PrimitivesProvider value={defaultPrimitives}>
            <PdfTemplateEditor
              slug={SLUG}
              locale="de"
              {...(onLocaleChange && { onLocaleChange })}
            />
          </PrimitivesProvider>
        </UserRolesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
  return fake;
}

async function ready(): Promise<void> {
  await screen.findByTestId("pdf-template-editor");
  await screen.findByTestId("pdf-editor-footer-message");
}

async function pickOption(triggerTestId: string, label: string): Promise<void> {
  fireEvent.click(await screen.findByTestId(triggerTestId));
  const option = (await screen.findAllByText(label)).find(
    (node) => node.closest("[role=option], [cmdk-item]") !== null,
  );
  if (option === undefined) throw new Error(`option ${label} not found`);
  fireEvent.click(option);
}

function buttonsNamed(name: string): HTMLButtonElement[] {
  return screen
    .getAllByRole("button")
    .filter(
      (button): button is HTMLButtonElement =>
        button instanceof HTMLButtonElement && button.textContent?.trim() === name,
    );
}

describe("PdfTemplateEditor", () => {
  test("a missing required placeholder is flagged and blocks publishing", async () => {
    renderEditor({ puppeteer: "available", missingRequired: ["customer"] });
    await ready();

    await waitFor(() =>
      expect(screen.getByTestId("pdf-placeholder-customer").textContent).toContain("missing"),
    );
    expect(screen.getByTestId("pdf-editor-footer-message").textContent).toContain(
      'Required placeholder "Customer" is missing. Publishing is blocked.',
    );
    for (const button of buttonsNamed("Publish")) expect(button.disabled).toBe(true);
  });

  test("without a PDF service the notice shows, generating is blocked and saving still works", async () => {
    renderEditor({ puppeteer: "unavailable" });
    await ready();

    await screen.findByText("PDF generation is not available: no browser");
    for (const button of buttonsNamed("Generate PDF")) expect(button.disabled).toBe(true);
    for (const button of buttonsNamed("Save")) expect(button.disabled).toBe(false);
  });

  test("an unknown status query counts as unavailable", async () => {
    renderEditor({ puppeteer: "unknown-query" });
    await ready();

    await screen.findByText(/PDF generation is not available/);
    for (const button of buttonsNamed("Generate PDF")) expect(button.disabled).toBe(true);
  });

  test("page settings travel in the saved meta", async () => {
    const { writes } = renderEditor({ puppeteer: "available" });
    await ready();

    fireEvent.change(document.getElementById("dd-file-name") as HTMLInputElement, {
      target: { value: "invoice-{{number}}.pdf" },
    });
    await pickOption("combobox-dd-page-format", "Letter");
    await pickOption("combobox-dd-orientation", "Landscape");
    fireEvent.click(buttonsNamed("Save")[0] as HTMLButtonElement);

    await waitFor(() => expect(writes.length).toBe(1));
    const [call] = writes;
    expect(call?.type).toBe(TemplateResolverHandlers.upsertTenant);
    expect(Reflect.get(Object(call?.payload), "meta")).toEqual({
      layoutSlug: "default",
      pageFormat: "Letter",
      orientation: "landscape",
      fileName: "invoice-{{number}}.pdf",
    });
    expect(Reflect.get(Object(call?.payload), "parentTemplateId")).toBe("row-de");
  });

  test("switching language with unsaved changes asks first and keeps the edit", async () => {
    const switched: string[] = [];
    renderEditor({ puppeteer: "available" }, (locale) => switched.push(locale));
    await ready();

    const fileName = document.getElementById("dd-file-name") as HTMLInputElement;
    fireEvent.change(fileName, { target: { value: "keep-me.pdf" } });
    fireEvent.click(buttonsNamed("en")[0] as HTMLButtonElement);

    await screen.findByText("Unsaved changes");
    expect(switched).toEqual([]);

    fireEvent.click(buttonsNamed("Cancel")[0] as HTMLButtonElement);
    await waitFor(() => expect(screen.queryByText("Unsaved changes")).toBeNull());
    expect((document.getElementById("dd-file-name") as HTMLInputElement).value).toBe("keep-me.pdf");
    expect(switched).toEqual([]);
  });

  test("a SystemAdmin opens the tenant customisation drawer with the breakdown", async () => {
    renderEditor({ puppeteer: "available" }, undefined, ["SystemAdmin"]);
    await ready();

    fireEvent.click(await screen.findByText("Show tenant customisations"));

    const drawer = await screen.findByTestId("document-designer-overrides-drawer");
    await waitFor(() => expect(drawer.textContent).toContain("Küstenwohnen Kiel GmbH"));
    const text = drawer.textContent ?? "";
    expect(text).toContain("Hansa Wohnbau eG");
    expect(text).toContain("2 tenants have their own version");
    expect(text).toContain("No registered notification uses this template directly.");
  });
});
