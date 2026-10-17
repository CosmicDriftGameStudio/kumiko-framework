import { describe, expect, test } from "bun:test";
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
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { documentDesignerClient } from "../client-plugin.js";
import { LayoutEditor } from "../layout-editor.js";
import type { LayoutSourceView } from "../layout-types.js";

const MJML = "<mjml><mj-body><mj-raw>{{{content}}}</mj-raw></mj-body></mjml>";

const tenantSource: LayoutSourceView = {
  tenant: { id: "t-1", version: 2, status: "active", locale: "de" },
  system: { id: "s-1", version: 3, status: "active", locale: "en", contentFormat: "html" },
  regions: { header: "<p>Kopf</p>", signature: "<p>Gruss</p>", footer: "<p>Fuss</p>" },
  effectiveFormat: "html",
  mjmlSource: null,
  meta: {},
  locale: "de",
};

const systemSource: LayoutSourceView = {
  tenant: null,
  system: { id: "s-1", version: 3, status: "active", locale: "en", contentFormat: "mjml" },
  regions: { header: "", signature: "", footer: "" },
  effectiveFormat: "mjml",
  mjmlSource: MJML,
  meta: {},
  locale: "en",
};

const okValidation = {
  canSave: true,
  canPublish: true,
  issues: [],
  publishIssues: [],
  used: [],
  systemPlaceholders: ["tenantName"],
};

type Call = { readonly type: string; readonly payload: unknown };

let brandingLogoFile = "";

function fakeDispatcher(source: LayoutSourceView | null, calls: Call[]): Dispatcher {
  const answers: Record<string, unknown> = {
    ...(source !== null && { "template-resolver:query:layout-source": source }),
    "template-resolver:query:overview": { rows: [], nextCursor: null, total: 0 },
    "template-resolver:query:validate": okValidation,
    "managed-pages:query:branding": {
      title: "Nordlicht",
      accentColor: "#205265",
      logoUrl: "",
      logoFile: brandingLogoFile,
      siteUrl: "https://nordlicht.example",
    },
    "template-resolver:query:tenant-overrides": {
      activeOverrides: 1,
      draftOverrides: 0,
      totalTenants: 4,
    },
  };
  return {
    write: (async (type: string, payload: unknown) => {
      calls.push({ type, payload });
      return { isSuccess: true, data: { id: "s-2" } };
    }) as unknown as Dispatcher["write"],
    batch: (async () => ({ isSuccess: true, data: [] })) as unknown as Dispatcher["batch"],
    query: (async (type: string, payload: unknown) => {
      calls.push({ type, payload });
      return type in answers
        ? { isSuccess: true, data: answers[type] }
        : {
            isSuccess: false,
            error: { code: "not_found", httpStatus: 404, i18nKey: "x", message: "" },
          };
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
  searchParams: { kind: "mail-layout", slug: "default" },
  setSearchParams: () => {},
};

const translations = mergeTranslations(
  mergeTranslations(kumikoDefaultTranslations, textBlocksClient().translations ?? {}),
  documentDesignerClient().translations ?? {},
);

function renderEditor(
  roles: readonly string[],
  source: LayoutSourceView | null,
  calls: Call[],
): void {
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[translations]}
    >
      <DispatcherProvider dispatcher={fakeDispatcher(source, calls)}>
        <UserRolesProvider roles={roles}>
          <PrimitivesProvider value={defaultPrimitives}>
            <NavProvider value={nav}>
              <LayoutEditor />
            </NavProvider>
          </PrimitivesProvider>
        </UserRolesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

describe("LayoutEditor", () => {
  test("a failing layout-source query shows the error instead of loading forever", async () => {
    renderEditor(["TenantAdmin"], null, []);
    await screen.findByTestId("document-designer-layout-error");
    expect(screen.queryByTestId("document-designer-paper")).toBeNull();
  });

  test("a tenant admin gets no MJML tab and a disabled save while nothing changed", async () => {
    renderEditor(["TenantAdmin"], tenantSource, []);
    await screen.findByTestId("document-designer-paper");
    expect(screen.queryByTestId("layout-mjml-tab")).toBeNull();
    expect(screen.getByTestId("document-designer-save").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("document-designer-origin-bar").textContent).toContain(
      "Overrides system layout v3",
    );
  });

  test("an open draft shows its number beside the served version in the header", async () => {
    renderEditor(
      ["TenantAdmin"],
      {
        ...tenantSource,
        tenant: {
          id: "t-1",
          version: 5,
          status: "draft",
          locale: "de",
          active: { version: 4, since: "2026-10-01T08:00:00Z" },
        },
      },
      [],
    );
    await screen.findByTestId("document-designer-paper");
    expect(screen.getByTestId("document-designer-editor-status").textContent).toBe("Draft v5");
    expect(screen.getByTestId("document-designer-editor-active-status").textContent).toBe(
      "Active v4",
    );
  });

  test("a served version without a draft shows a single status badge", async () => {
    renderEditor(["TenantAdmin"], tenantSource, []);
    await screen.findByTestId("document-designer-paper");
    expect(screen.getByTestId("document-designer-editor-status").textContent).toBe("Active v2");
    expect(screen.queryByTestId("document-designer-editor-active-status")).toBeNull();
  });

  test("a platform admin sees the MJML tab and saves the edited source as system mjml", async () => {
    const calls: Call[] = [];
    renderEditor(["SystemAdmin"], systemSource, calls);
    await screen.findByTestId("layout-mjml-tab");

    const field = await screen.findByTestId("document-designer-mjml-source");
    const textarea = field.querySelector("textarea") ?? field;
    fireEvent.change(textarea, { target: { value: `${MJML}<!-- edited -->` } });

    const save = screen.getByTestId("document-designer-save");
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    fireEvent.click(save);

    await waitFor(() =>
      expect(
        calls.find((call) => call.type === "template-resolver:write:upsert-system"),
      ).toBeDefined(),
    );
    const upsert = calls.find((call) => call.type === "template-resolver:write:upsert-system");
    expect(upsert?.payload).toMatchObject({
      slug: "default",
      kind: "mail-layout",
      locale: "en",
      contentFormat: "mjml",
      content: `${MJML}<!-- edited -->`,
    });
  });

  test("the MJML preview rail is hidden in the MJML tab and shown in the draft tab", async () => {
    renderEditor(["SystemAdmin"], systemSource, []);
    await screen.findByTestId("document-designer-mjml-source");
    expect(screen.queryByTestId("document-designer-mjml-preview")).toBeNull();

    fireEvent.click(
      within(screen.getByTestId("layout-mjml-tab")).getByRole("button", { name: "Draft" }),
    );
    await screen.findByTestId("document-designer-paper");
    expect(screen.getByTestId("document-designer-mjml-preview")).toBeDefined();
  });

  test("publishing as platform admin saves and then publishes the saved version", async () => {
    const calls: Call[] = [];
    renderEditor(["SystemAdmin"], systemSource, calls);
    const field = await screen.findByTestId("document-designer-mjml-source");
    fireEvent.change(field.querySelector("textarea") ?? field, {
      target: { value: `${MJML}<!-- v2 -->` },
    });
    const publish = screen.getByTestId("document-designer-publish");
    await waitFor(() => expect(publish.hasAttribute("disabled")).toBe(false));
    fireEvent.click(publish);

    await waitFor(() =>
      expect(
        calls.find((call) => call.type === "template-resolver:write:publish-system"),
      ).toBeDefined(),
    );
    expect(
      calls.find((call) => call.type === "template-resolver:write:publish-system")?.payload,
    ).toEqual({
      id: "s-2",
    });
  });

  test("a tenant admin publishing a draft sends the composed regions as active html", async () => {
    const calls: Call[] = [];
    renderEditor(
      ["TenantAdmin"],
      { ...tenantSource, tenant: { id: "t-1", version: 4, status: "draft", locale: "de" } },
      calls,
    );
    const publish = await screen.findByTestId("document-designer-publish");
    await waitFor(() => expect(publish.hasAttribute("disabled")).toBe(false));
    fireEvent.click(publish);

    await waitFor(() =>
      expect(
        calls.find((call) => call.type === "template-resolver:write:upsert-tenant"),
      ).toBeDefined(),
    );
    expect(
      calls.find((call) => call.type === "template-resolver:write:upsert-tenant")?.payload,
    ).toEqual({
      slug: "default",
      kind: "mail-layout",
      locale: "de",
      contentFormat: "html",
      meta: {},
      status: "active",
      content:
        "<div data-header><p>Kopf</p></div><div data-content></div><div data-signature><p>Gruss</p></div><div data-footer><p>Fuss</p></div>",
    });
  });

  test("the header shows the branding logo as an image instead of a resource chip", async () => {
    brandingLogoFile = "file-1";
    try {
      renderEditor(
        ["TenantAdmin"],
        {
          ...tenantSource,
          regions: {
            ...tenantSource.regions,
            header: '<p><img data-resource="logo" alt="Logo"></p>',
          },
        },
        [],
      );
      const header = await screen.findByTestId("document-designer-region-header");
      await waitFor(() =>
        expect(header.querySelector("img")?.getAttribute("src")).toBe("/api/files/file-1"),
      );
      expect(header.textContent).toContain("from branding, max. 180 px wide");
    } finally {
      brandingLogoFile = "";
    }
  });

  test("appearance edits are saved as layout meta, keeping only non-default values", async () => {
    const calls: Call[] = [];
    renderEditor(["TenantAdmin"], tenantSource, calls);
    const width = await screen.findByLabelText("Width");
    fireEvent.click(width);
    fireEvent.click(await screen.findByRole("option", { name: "640 px" }));
    const save = screen.getByTestId("document-designer-save");
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    fireEvent.click(save);
    await waitFor(() =>
      expect(
        calls.find((call) => call.type === "template-resolver:write:upsert-tenant"),
      ).toBeDefined(),
    );
    expect(
      calls.find((call) => call.type === "template-resolver:write:upsert-tenant")?.payload,
    ).toMatchObject({ meta: { width: 640 }, status: "draft" });
  });

  test("an invalid outer background blocks saving and publishing and says why", async () => {
    renderEditor(["TenantAdmin"], tenantSource, []);
    const background = await screen.findByLabelText("Outer background");
    fireEvent.change(background, { target: { value: "red" } });
    await waitFor(() =>
      expect(screen.getByTestId("document-designer-footer-message").textContent).toContain(
        "Enter a colour like #f3f2ee.",
      ),
    );
    expect(screen.getByTestId("document-designer-save").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("document-designer-publish").hasAttribute("disabled")).toBe(true);
  });

  test("an mjml layout shows where its look comes from instead of appearance controls", async () => {
    renderEditor(["SystemAdmin"], systemSource, []);
    const rail = await screen.findByTestId("document-designer-appearance");
    expect(rail.textContent).toContain("layout's MJML source");
    expect(screen.queryByLabelText("Width")).toBeNull();
  });
});
