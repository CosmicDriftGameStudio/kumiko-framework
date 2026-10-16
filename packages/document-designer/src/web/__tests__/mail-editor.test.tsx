import { afterEach, describe, expect, test } from "bun:test";
import { textBlocksClient } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import {
  createStaticLocaleResolver,
  DispatcherProvider,
  kumikoDefaultTranslations,
  LocaleProvider,
  mergeTranslations,
  type NavApi,
  NavProvider,
  PrimitivesProvider,
  UserRolesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { documentDesignerClient } from "../client-plugin.js";
import { createMailEditor } from "../mail-editor.js";
import { PreviewRecordPickerProvider } from "../preview-record-picker.js";

const SLUG = "billing:notify:invoice-issued";

const overviewRow = {
  id: `mail|${SLUG}`,
  slug: SLUG,
  kind: "mail",
  kindGroup: "mail",
  title: "Rechnung versendet",
  origin: "tenant",
  locales: ["de"],
  status: "draft",
  version: 4,
  systemVersion: 5,
  layoutSlug: "default",
  modifiedAt: "2026-10-14T10:00:00.000Z",
  usedBy: [
    {
      qualifiedName: "billing:notification:invoice-issued",
      feature: "billing",
      notification: "invoice-issued",
      trigger: null,
    },
  ],
  usedByCount: 1,
};

function storedRow(status: string): Record<string, unknown> {
  return {
    id: "t-1",
    version: 4,
    tenantId: "tenant-1",
    slug: SLUG,
    kind: "mail",
    locale: "de",
    scope: "tenant",
    status,
    contentFormat: "html",
    content: "<p>Hallo</p>",
    variableSchema: "{}",
    linkedResources: "{}",
    meta: JSON.stringify({ subject: "Ihre Rechnung", category: "transactional" }),
    modifiedAt: "2026-10-14T10:00:00.000Z",
  };
}

const validation = {
  canSave: true,
  canPublish: false,
  issues: [],
  publishIssues: [
    {
      path: "content",
      code: "required_placeholder_missing",
      i18nKey: "templateResolver.errors.requiredMissing",
    },
  ],
  used: ["invoiceNumber"],
  unknown: [],
  missingRequired: ["dueDate"],
  warnings: [],
  variables: {
    invoiceNumber: { type: "text", label: "Invoice number", required: true },
    dueDate: { type: "date", label: "Due date", required: true },
  },
  systemPlaceholders: ["tenantName"],
};

const preview = {
  kind: "mail",
  subject: "Ihre Rechnung",
  previewText: null,
  html: "<p>Hallo</p>",
  displayHtml: '<p>Hallo</p><b data-testid="leak">injected</b>',
  text: "Hallo",
  attachments: [{ kind: "file", name: "agb.pdf", sizeBytes: 2048 }],
  layout: { slug: "default", scope: "system" },
  sampleValues: { invoiceNumber: "RE-1" },
  checks: [{ code: "text_present", ok: true, i18nKey: "templateResolver.checks.textPresent" }],
  validation,
};

type Call = { readonly type: string; readonly payload: unknown };

function fakeDispatcher(status: string, calls: Call[], validationAnswer = validation): Dispatcher {
  const answer = (type: string): unknown => {
    switch (type) {
      case "template-resolver:query:overview":
        return { rows: [overviewRow], nextCursor: null, total: 1 };
      case "template-resolver:query:list":
        return [
          {
            id: "t-1",
            slug: SLUG,
            kind: "mail",
            locale: "de",
            scope: "tenant",
            status,
            modifiedAt: "x",
          },
        ];
      case "template-resolver:query:find-by-id":
        return storedRow(status);
      case "template-resolver:query:validate":
        return validationAnswer;
      case "template-resolver:query:preview":
        return preview;
      case "template-resolver:query:usage":
        return { usedBy: [] };
      default:
        return undefined;
    }
  };
  return {
    write: (async (type: string, payload: unknown) => {
      calls.push({ type, payload });
      return { isSuccess: true, data: { id: "t-1" } };
    }) as unknown as Dispatcher["write"],
    batch: (async () => ({ isSuccess: true, data: [] })) as unknown as Dispatcher["batch"],
    query: (async (type: string, payload: unknown) => {
      calls.push({ type, payload });
      const data = answer(type);
      return data === undefined
        ? {
            isSuccess: false,
            error: { code: "not_found", httpStatus: 404, i18nKey: "x", message: "" },
          }
        : { isSuccess: true, data };
    }) as unknown as Dispatcher["query"],
    statusStore: {
      getState: () => "online",
      subscribe: () => () => {},
    } as unknown as Dispatcher["statusStore"],
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
}

const nav: NavApi = {
  route: undefined,
  navigate: () => {},
  replace: () => {},
  hrefFor: () => "#",
  searchParams: { slug: SLUG, kind: "mail" },
  setSearchParams: () => {},
};

const translations = mergeTranslations(
  mergeTranslations(kumikoDefaultTranslations, textBlocksClient().translations ?? {}),
  documentDesignerClient().translations ?? {},
);
const MailEditor = createMailEditor(["de", "en"]);

function renderEditor(dispatcher: Dispatcher, wrapper?: (children: ReactNode) => ReactNode): void {
  const editor = <MailEditor />;
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[translations]}
    >
      <DispatcherProvider dispatcher={dispatcher}>
        <UserRolesProvider roles={["TenantAdmin"]}>
          <PrimitivesProvider value={defaultPrimitives}>
            <NavProvider value={nav}>
              {wrapper === undefined ? editor : wrapper(editor)}
            </NavProvider>
          </PrimitivesProvider>
        </UserRolesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

async function makeDirty(): Promise<void> {
  const category = await screen.findByTestId("mail-editor-properties");
  const marketing = Array.from(category.querySelectorAll("input,button,option")).find(
    (node) => node.textContent === "Marketing" || (node as HTMLInputElement).value === "marketing",
  );
  if (marketing === undefined) throw new Error("category control not found");
  if (
    marketing instanceof HTMLOptionElement &&
    marketing.parentElement instanceof HTMLSelectElement
  ) {
    fireEvent.change(marketing.parentElement, { target: { value: "marketing" } });
  } else {
    fireEvent.click(marketing);
  }
}

afterEach(cleanup);

describe("MailEditor", () => {
  test("publishing is disabled while a required placeholder is missing", async () => {
    renderEditor(fakeDispatcher("draft", []));
    const row = await screen.findByTestId("mail-placeholder-dueDate");
    expect(row.getAttribute("data-bad")).toBe("true");
    expect(screen.getByTestId("document-designer-publish").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("mail-header-publish").hasAttribute("disabled")).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId("mail-editor-footer-message").textContent).toContain("Due date"),
    );
  });

  test("saving writes a draft with the overview title and document content", async () => {
    const calls: Call[] = [];
    renderEditor(fakeDispatcher("draft", calls));
    await makeDirty();
    const save = screen.getByTestId("document-designer-save");
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    fireEvent.click(save);
    await waitFor(() =>
      expect(calls.some((call) => call.type === "template-resolver:write:upsert-tenant")).toBe(
        true,
      ),
    );
    const upsert = calls.find((call) => call.type === "template-resolver:write:upsert-tenant");
    expect(upsert?.payload).toMatchObject({
      slug: SLUG,
      kind: "mail",
      locale: "de",
      title: "Rechnung versendet",
      contentFormat: "html",
      status: "draft",
      content: "<p>Hallo</p>",
      meta: { subject: "Ihre Rechnung", category: "marketing" },
    });
  });

  test("saving an active row asks before it goes back to draft", async () => {
    const calls: Call[] = [];
    renderEditor(fakeDispatcher("active", calls));
    await makeDirty();
    const save = screen.getByTestId("document-designer-save");
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    fireEvent.click(save);
    await screen.findByText(/takes the active customisation offline/);
    expect(calls.some((call) => call.type === "template-resolver:write:upsert-tenant")).toBe(false);
  });

  test("switching the language with unsaved changes asks first", async () => {
    renderEditor(fakeDispatcher("draft", []));
    await makeDirty();
    const switcher = await screen.findByTestId("mail-locale-switch");
    const english = Array.from(switcher.querySelectorAll("button,input,label")).find(
      (node) => node.textContent === "en",
    );
    if (english === undefined) throw new Error("en option not found");
    fireEvent.click(english);
    expect(await screen.findByText("Unsaved changes")).toBeTruthy();
  });

  test("the preview renders the mail in a sandboxed iframe and never as innerHTML", async () => {
    renderEditor(fakeDispatcher("draft", []));
    const switcher = await screen.findByTestId("mail-mode-switch");
    const previewOption = Array.from(switcher.querySelectorAll("button,input,label")).find(
      (node) => node.textContent === "Preview",
    );
    if (previewOption === undefined) throw new Error("preview option not found");
    fireEvent.click(previewOption);
    const frame = await screen.findByTestId("mail-preview-iframe");
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("srcdoc")).toContain('data-testid="leak"');
    expect(screen.queryByTestId("leak")).toBeNull();
    expect(screen.getByTestId("mail-preview-attachments").textContent).toContain("agb.pdf");
  });

  test("the record picker link only shows with a provider", async () => {
    const open = async (): Promise<void> => {
      const switcher = await screen.findByTestId("mail-mode-switch");
      const option = Array.from(switcher.querySelectorAll("button,input,label")).find(
        (node) => node.textContent === "Preview",
      );
      if (option === undefined) throw new Error("preview option not found");
      fireEvent.click(option);
      await screen.findByTestId("mail-preview-iframe");
    };
    renderEditor(fakeDispatcher("draft", []));
    await open();
    expect(screen.queryByTestId("mail-record-picker-open")).toBeNull();
    cleanup();

    renderEditor(fakeDispatcher("draft", []), (children) => (
      <PreviewRecordPickerProvider value={{ label: "Pick invoice", renderPicker: () => null }}>
        {children}
      </PreviewRecordPickerProvider>
    ));
    await open();
    expect((await screen.findByTestId("mail-record-picker-open")).textContent).toContain(
      "Pick invoice",
    );
  });
});
