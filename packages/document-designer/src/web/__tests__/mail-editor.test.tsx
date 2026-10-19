import { afterEach, describe, expect, test } from "bun:test";
import { ConfigQueries } from "@cosmicdrift/kumiko-bundled-features/config/web";
import { textBlocksClient } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import {
  AppFeaturesProvider,
  createStaticLocaleResolver,
  DispatcherProvider,
  type FeatureSchema,
  kumikoDefaultTranslations,
  LocaleProvider,
  mergeTranslations,
  type NavApi,
  NavProvider,
  PrimitivesProvider,
  UserRolesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { type Dispatcher, formatMoney } from "@cosmicdrift/kumiko-renderer/headless";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { TENANT_CURRENCY_CONFIG_KEY } from "@cosmicdrift/kumiko-types/fields";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { TENANT_MAIL_SENDING_SCREEN_ID } from "../../constants.ts";
import { documentDesignerClient } from "../client-plugin.tsx";
import { createMailEditor } from "../mail-editor.tsx";
import { PreviewRecordPickerProvider } from "../preview-record-picker.tsx";

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

const STORED_META = { subject: "Ihre Rechnung", category: "transactional" };

function storedRow(
  status: string,
  meta: Readonly<Record<string, string>> = STORED_META,
): Record<string, unknown> {
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
    meta: JSON.stringify(meta),
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

function fakeDispatcher(
  status: string,
  calls: Call[],
  validationAnswer = validation,
  previewAnswer = preview,
  storedMeta: Readonly<Record<string, string>> = STORED_META,
  sendTestStatus: unknown = { canSend: true, reason: null },
): Dispatcher {
  const answer = (type: string, payload: unknown): unknown => {
    switch (type) {
      case "template-resolver:query:overview":
        return { rows: [overviewRow], nextCursor: null, total: 1 };
      case "template-resolver:query:list": {
        const asked = (payload as { locale?: string } | undefined)?.locale;
        if (asked !== undefined && asked !== "de") return [];
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
      }
      case "template-resolver:query:find-by-id":
        return storedRow(status, storedMeta);
      case "template-resolver:query:validate":
        return validationAnswer;
      case "template-resolver:query:preview":
        return previewAnswer;
      case "template-resolver:query:usage":
        return { usedBy: [] };
      case "template-resolver:query:send-test-status":
        return sendTestStatus;
      case "user:query:user:me":
        return { email: "editor@example.org" };
      case ConfigQueries.values:
        return { [TENANT_CURRENCY_CONFIG_KEY]: { value: "CHF" } };
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
      const data = answer(type, payload);
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

function withTenantTransportUsage(base: Dispatcher): Dispatcher {
  return {
    ...base,
    query: (async (type: string, payload: unknown) =>
      type === "template-resolver:query:usage"
        ? {
            isSuccess: true,
            data: {
              usedBy: [
                { feature: "billing", notification: "invoice-issued", tenantTransport: true },
              ],
            },
          }
        : base.query(type as never, payload as never)) as unknown as Dispatcher["query"],
  };
}

// Only the screen list matters to the sender hint's link check.
const FILES_FEATURE = { featureName: "files", screens: [] } as unknown as FeatureSchema;

const MAIL_SENDING_FEATURE = {
  name: "mail-foundation",
  screens: [{ id: TENANT_MAIL_SENDING_SCREEN_ID }],
} as unknown as FeatureSchema;

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

function renderEditor(
  dispatcher: Dispatcher,
  wrapper?: (children: ReactNode) => ReactNode,
  navApi: NavApi = nav,
): void {
  const editor = <MailEditor />;
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[translations]}
    >
      <DispatcherProvider dispatcher={dispatcher}>
        <UserRolesProvider roles={["TenantAdmin"]}>
          <PrimitivesProvider value={defaultPrimitives}>
            <NavProvider value={navApi}>
              {wrapper === undefined ? editor : wrapper(editor)}
            </NavProvider>
          </PrimitivesProvider>
        </UserRolesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

async function openPreview(): Promise<void> {
  const switcher = await screen.findByTestId("mail-mode-switch");
  const option = Array.from(switcher.querySelectorAll("button,input,label")).find(
    (node) => node.textContent === "Preview",
  );
  if (option === undefined) throw new Error("preview option not found");
  fireEvent.click(option);
  await screen.findByTestId("mail-preview-iframe");
}

async function makeDirty(): Promise<void> {
  fireEvent.click(await screen.findByTestId("combobox-mail-category"));
  const marketing = (await screen.findAllByText("Marketing")).find(
    (node) => node.closest("[role=option], [cmdk-item]") !== null,
  );
  if (marketing === undefined) throw new Error("category option not found");
  fireEvent.click(marketing);
}

afterEach(cleanup);

describe("MailEditor", () => {
  test("a language without a version shows an empty state and no editor, subject or raw parser text", async () => {
    const englishNav: NavApi = { ...nav, searchParams: { ...nav.searchParams, locale: "en" } };
    renderEditor(fakeDispatcher("draft", []), undefined, englishNav);
    const canvas = await screen.findByTestId("mail-missing-locale");
    expect(canvas.textContent).toContain(
      "There is no version for English yet. Recipients with language en get the German version.",
    );
    expect(screen.getByTestId("mail-copy-locale").textContent).toBe("Copy from German");
    expect(screen.getByTestId("mail-create-blank")).toBeTruthy();
    expect(screen.queryByTestId("mail-subject")).toBeNull();
    expect(screen.getByTestId("mail-sender")).toBeTruthy();
    // The placeholder rail comes from the validate query, which settles independently
    // of the missing-locale canvas, so it has to be awaited on its own.
    expect(
      (await screen.findByTestId("mail-placeholder-dueDate")).getAttribute("data-bad"),
    ).toBeNull();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Too small");
    expect(text).not.toContain("expected string");
  });

  test("a missing subject is reported in plain words at the field, never as parser text", async () => {
    const withIssue = {
      ...validation,
      canSave: false,
      issues: [
        {
          path: "meta.subject",
          code: "invalid_meta",
          i18nKey: "templateResolver.errors.template.meta.subject.required",
        },
      ],
    };
    renderEditor(fakeDispatcher("draft", [], withIssue));
    await waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("The subject is missing.");
    });
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Too small");
    expect(text).not.toContain("expected string");
  });

  test("publishing is disabled while a required placeholder is missing", async () => {
    renderEditor(fakeDispatcher("draft", []));
    const row = await screen.findByTestId("mail-placeholder-dueDate");
    expect(row.getAttribute("data-bad")).toBe("true");
    expect(screen.getByTestId("document-designer-header-publish").hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.getByTestId("document-designer-publish").hasAttribute("disabled")).toBe(true);
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

  test("the header carries save and the origin badge", async () => {
    const calls: Call[] = [];
    renderEditor(fakeDispatcher("draft", calls));
    await makeDirty();
    const save = screen.getByTestId("document-designer-header-save");
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    expect(screen.getByTestId("document-designer-editor-origin").textContent).not.toBe("");
    fireEvent.click(save);
    await waitFor(() =>
      expect(calls.some((call) => call.type === "template-resolver:write:upsert-tenant")).toBe(
        true,
      ),
    );
  });

  test("sender name and reply-to are part of the saved meta", async () => {
    const calls: Call[] = [];
    renderEditor(fakeDispatcher("draft", calls));
    fireEvent.change(await screen.findByTestId("mail-sender"), {
      target: { value: "Nordlicht Immobilien" },
    });
    fireEvent.change(screen.getByTestId("mail-reply-to"), {
      target: { value: "buchhaltung@example.org" },
    });
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
      meta: { senderName: "Nordlicht Immobilien", replyTo: "buchhaltung@example.org" },
    });
  });

  test("the rail keeps the stored header chip and footer note, and a changed tone is previewed and saved", async () => {
    const calls: Call[] = [];
    const chromeValidation = {
      ...validation,
      variables: {
        ...validation.variables,
        eventLabel: { type: "text", label: "Event name" },
        tone: { type: "text", label: "Incident colour" },
      },
    };
    renderEditor(
      fakeDispatcher("draft", calls, chromeValidation, preview, {
        ...STORED_META,
        headerChip: "{{eventLabel}}",
        tone: "{{tone}}",
        footerNote: "Sie erhalten diese Mail als Kunde.",
      }),
    );
    const chrome = await screen.findByTestId("mail-editor-chrome");
    expect(chrome.textContent).toContain("Label in the header");
    // The rail names placeholders by their label only, never by the raw name.
    await waitFor(() => expect(chrome.textContent).toContain("Event name"));
    expect(chrome.textContent).not.toContain("eventLabel");
    expect(chrome.textContent).not.toContain("{{");
    const toneSelect = await screen.findByTestId("combobox-mail-tone");
    // A placeholder tone is kept as its own option instead of being reset to the default.
    await waitFor(() =>
      expect(toneSelect.textContent).toContain("From placeholder: Incident colour"),
    );
    fireEvent.click(toneSelect);
    const warning = (await screen.findAllByText("Warning (amber)")).find(
      (node) => node.closest("[role=option], [cmdk-item]") !== null,
    );
    if (warning === undefined) throw new Error("tone option not found");
    fireEvent.click(warning);
    // The preview renders the unsaved draft, so the tone shows before saving.
    await openPreview();
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.type === "template-resolver:query:preview" &&
            JSON.stringify(call.payload).includes('"tone":"warning"'),
        ),
      ).toBe(true),
    );
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
      meta: {
        headerChip: "{{eventLabel}}",
        tone: "warning",
        footerNote: "Sie erhalten diese Mail als Kunde.",
      },
    });
  });

  test("choosing the accent tone stores no tone, the renderer default", async () => {
    const calls: Call[] = [];
    renderEditor(
      fakeDispatcher("draft", calls, validation, preview, { ...STORED_META, tone: "danger" }),
    );
    const toneSelect = await screen.findByTestId("combobox-mail-tone");
    await waitFor(() => expect(toneSelect.textContent).toContain("Danger (red)"));
    fireEvent.click(toneSelect);
    const accent = (await screen.findAllByText("Accent colour (default)")).find(
      (node) => node.closest("[role=option], [cmdk-item]") !== null,
    );
    if (accent === undefined) throw new Error("accent option not found");
    fireEvent.click(accent);
    const save = screen.getByTestId("document-designer-save");
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    fireEvent.click(save);
    await waitFor(() =>
      expect(calls.some((call) => call.type === "template-resolver:write:upsert-tenant")).toBe(
        true,
      ),
    );
    const upsert = calls.find((call) => call.type === "template-resolver:write:upsert-tenant");
    const meta = (upsert?.payload as { meta?: Record<string, unknown> } | undefined)?.meta;
    expect(meta).toBeDefined();
    expect(meta?.tone).toBeUndefined();
  });

  test("saving an active row writes a draft without asking", async () => {
    const calls: Call[] = [];
    renderEditor(fakeDispatcher("active", calls));
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
    expect(upsert?.payload).toMatchObject({ status: "draft" });
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

  test("the test mail goes to the own address and can leave the attachments out", async () => {
    const calls: Call[] = [];
    renderEditor(fakeDispatcher("draft", calls));
    await openPreview();
    await waitFor(() =>
      expect((screen.getByTestId("mail-test-recipient") as HTMLInputElement).value).toBe(
        "editor@example.org",
      ),
    );
    expect(screen.getByTestId("mail-preview-to").textContent).toBe("editor@example.org");
    fireEvent.click(screen.getByTestId("mail-test-send"));
    await waitFor(() =>
      expect(calls.some((call) => call.type === "template-resolver:write:send-test")).toBe(true),
    );
    expect(
      calls.find((call) => call.type === "template-resolver:write:send-test")?.payload,
    ).toMatchObject({
      includeAttachments: true,
    });

    const attachments = document.getElementById("mail-test-attachments");
    if (attachments === null) throw new Error("attachment checkbox not found");
    fireEvent.click(attachments);
    fireEvent.click(screen.getByTestId("mail-test-send"));
    await waitFor(() =>
      expect(
        calls.filter((call) => call.type === "template-resolver:write:send-test"),
      ).toHaveLength(2),
    );
    expect(
      calls.filter((call) => call.type === "template-resolver:write:send-test")[1]?.payload,
    ).toMatchObject({ includeAttachments: false });
  });

  test("the German sample values show money and dates the way the rendered mail does", async () => {
    const formattedValidation = {
      ...validation,
      missingRequired: [],
      variables: {
        ...validation.variables,
        total: { type: "money", label: "Invoice total" },
        fee: { type: "money", label: "Late fee" },
      },
    };
    const dispatcher = fakeDispatcher("draft", [], formattedValidation, {
      ...preview,
      sampleValues: {
        invoiceNumber: "RE-1",
        dueDate: "2026-01-15",
        total: { amount: 128450, currency: "EUR" },
        fee: 500,
      },
    });
    renderEditor(dispatcher);
    await openPreview();

    expect((await screen.findByTestId("mail-sample-total")).textContent).toContain(
      formatMoney(128450, "EUR", "de"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("mail-sample-fee").textContent).toContain(
        formatMoney(500, "CHF", "de"),
      ),
    );
    expect(screen.getByTestId("mail-sample-dueDate").textContent).toContain("15. Januar 2026");
    const bar = screen.getByTestId("mail-preview-side").textContent ?? "";
    expect(bar).not.toContain("128450");
    expect(bar).not.toContain("2026-01-15");
  });

  test("a template without attachments says so instead of offering the checkbox", async () => {
    renderEditor(fakeDispatcher("draft", [], validation, { ...preview, attachments: [] }));
    await openPreview();
    expect(await screen.findByTestId("mail-test-no-attachments")).toBeTruthy();
    expect(document.getElementById("mail-test-attachments")).toBeNull();
  });

  test("the sender hint names the platform for a platform-sent mail and the tenant's email sending, with a link, for a tenant-routed one", async () => {
    renderEditor(fakeDispatcher("draft", []));
    expect(
      await screen.findByText("The address comes from the platform's mail delivery."),
    ).toBeTruthy();
    cleanup();

    const navigated: unknown[] = [];
    const recordingNav: NavApi = { ...nav, navigate: (target) => navigated.push(target) };
    renderEditor(
      withTenantTransportUsage(fakeDispatcher("draft", [])),
      (children) => (
        <AppFeaturesProvider features={[MAIL_SENDING_FEATURE]}>{children}</AppFeaturesProvider>
      ),
      recordingNav,
    );
    expect(
      await screen.findByText(
        /The address comes from your organization's email sending settings\./,
      ),
    ).toBeTruthy();
    const link = await screen.findByTestId("mail-sender-settings-link");
    expect(link.textContent).toBe("Open email sending");
    fireEvent.click(link);
    expect(navigated).toEqual([{ screenId: TENANT_MAIL_SENDING_SCREEN_ID }]);
    cleanup();

    renderEditor(withTenantTransportUsage(fakeDispatcher("draft", [])));
    expect(
      await screen.findByText(
        /The address comes from your organization's email sending settings\./,
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("mail-sender-settings-link")).toBeNull();
  });

  test("the record picker link only shows with a provider", async () => {
    const open = openPreview;
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

  test("picked record values go into the preview query and the test mail, and not before", async () => {
    const calls: Call[] = [];
    const previewCalls = (): Call[] =>
      calls.filter((call) => call.type === "template-resolver:query:preview");
    const pickedValues = { invoiceNumber: "RE-PICKED-1" };
    renderEditor(fakeDispatcher("draft", calls), (children) => (
      <PreviewRecordPickerProvider
        value={{
          label: "Pick invoice",
          renderPicker: ({ onPick }) => (
            <button type="button" data-testid="fake-pick" onClick={() => onPick(pickedValues)}>
              pick
            </button>
          ),
        }}
      >
        {children}
      </PreviewRecordPickerProvider>
    ));
    await openPreview();
    await waitFor(() => expect(previewCalls().length).toBeGreaterThan(0));
    expect(previewCalls().every((call) => !("variables" in (call.payload as object)))).toBe(true);

    fireEvent.click(await screen.findByTestId("mail-record-picker-open"));
    fireEvent.click(await screen.findByTestId("fake-pick"));
    await waitFor(() =>
      expect(previewCalls().at(-1)?.payload).toMatchObject({ variables: pickedValues }),
    );

    fireEvent.click(screen.getByTestId("mail-test-send"));
    await waitFor(() =>
      expect(
        calls.find((call) => call.type === "template-resolver:write:send-test")?.payload,
      ).toMatchObject({ variables: pickedValues }),
    );
  });
  test("the test mail button stays off with a hint when the server has no address for the user", async () => {
    const noAddress = { canSend: false, reason: "no_address" };
    renderEditor(fakeDispatcher("draft", [], validation, preview, STORED_META, noAddress));
    await openPreview();
    expect(
      await screen.findByText("No email address is stored for you, so no test mail can be sent."),
    ).toBeTruthy();
    expect((screen.getByTestId("mail-test-send") as HTMLButtonElement).disabled).toBe(true);
  });

  test("the test mail button is enabled when the server can send", async () => {
    renderEditor(fakeDispatcher("draft", []));
    await openPreview();
    await waitFor(() =>
      expect((screen.getByTestId("mail-test-send") as HTMLButtonElement).disabled).toBe(false),
    );
  });

  test("upload is disabled with a hint when the files feature is not mounted", async () => {
    renderEditor(fakeDispatcher("draft", []));
    const upload = await screen.findByTestId("mail-resource-upload-open");
    expect((upload as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText("Uploads need the files feature, which this app has not mounted."),
    ).toBeTruthy();
    cleanup();

    renderEditor(fakeDispatcher("draft", []), (children) => (
      <AppFeaturesProvider features={[FILES_FEATURE]}>{children}</AppFeaturesProvider>
    ));
    await waitFor(() =>
      expect((screen.getByTestId("mail-resource-upload-open") as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    expect(screen.queryByText(/Uploads need the files feature/)).toBeNull();
  });
});
