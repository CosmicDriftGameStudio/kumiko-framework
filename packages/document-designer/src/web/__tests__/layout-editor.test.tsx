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
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  locale: "de",
};

const systemSource: LayoutSourceView = {
  tenant: null,
  system: { id: "s-1", version: 3, status: "active", locale: "en", contentFormat: "mjml" },
  regions: { header: "", signature: "", footer: "" },
  effectiveFormat: "mjml",
  mjmlSource: MJML,
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

function fakeDispatcher(source: LayoutSourceView | null, calls: Call[]): Dispatcher {
  const answers: Record<string, unknown> = {
    ...(source !== null && { "template-resolver:query:layout-source": source }),
    "template-resolver:query:overview": { rows: [], nextCursor: null, total: 0 },
    "template-resolver:query:validate": okValidation,
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
});
