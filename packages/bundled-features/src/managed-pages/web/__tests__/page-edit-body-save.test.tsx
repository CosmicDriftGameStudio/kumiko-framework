// The page-edit screen with the real body section and the server's own body gate: a Markdown
// page converts to a document that the gate accepts, and a body the server rejects is shown.

import { afterEach, describe, expect, test } from "bun:test";
import {
  createStaticLocaleResolver,
  DispatcherProvider,
  ExtensionSectionsProvider,
  type FeatureSchema,
  KumikoScreen,
  kumikoDefaultTranslations,
  LocaleProvider,
  NavProvider,
  PrimitivesProvider,
  UserRolesProvider,
} from "@cosmicdrift/kumiko-renderer";
import type { Dispatcher } from "@cosmicdrift/kumiko-renderer/headless";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defaultTranslations as templateResolverTranslations } from "../../../template-resolver/web/i18n.ts";
import { BODY_REJECTED_I18N_KEY, sanitizePageBody } from "../../handlers/page-body-issues.ts";
import { pageEditScreen } from "../../screens/page-screens.ts";
import { pageEntity } from "../../table.ts";
import { PAGE_BODY_EXTENSION_NAME } from "../constants.ts";
import { defaultTranslations } from "../default-translations.ts";
import { PageBodySection } from "../page-body-section.tsx";

type PageChanges = { body?: string; bodyFormat?: string };
let writes: PageChanges[] = [];

type RejectingFields = ReturnType<typeof rejection>;

function rejection(detail: string) {
  return {
    isSuccess: false as const,
    error: {
      code: "validation_error",
      httpStatus: 400,
      i18nKey: "kumiko.errors.validation",
      message: "validation failed",
      details: {
        fields: [
          {
            path: "body",
            code: "script_element",
            i18nKey: BODY_REJECTED_I18N_KEY,
            params: { detail },
          },
        ],
      },
    },
  };
}

// Mirrors the server write path: the same body gate the update handler runs.
function gatedDispatcher(
  record: Readonly<Record<string, unknown>>,
  forcedRejection?: RejectingFields,
): Dispatcher {
  return {
    write: (async (_type: string, payload: unknown) => {
      const changes = (payload as { changes: PageChanges }).changes;
      writes.push(changes);
      if (forcedRejection !== undefined) return forcedRejection;
      const gate = sanitizePageBody(changes.body, changes.bodyFormat);
      if (!gate.ok) return rejection(gate.issues[0]?.params?.["detail"] as string);
      return { isSuccess: true, data: {} };
    }) as unknown as Dispatcher["write"],
    query: (async () => ({ isSuccess: true, data: record })) as unknown as Dispatcher["query"],
    batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
    statusStore: {
      getState: () => "online",
      subscribe: () => () => {},
    } as unknown as Dispatcher["statusStore"],
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
}

const schema = {
  featureName: "managed-pages",
  entities: { page: pageEntity },
  screens: [pageEditScreen],
} as FeatureSchema;

const MARKDOWN_RECORD = {
  id: "p1",
  version: 4,
  slug: "about",
  lang: "en",
  title: "About",
  body: "Reach us via [Contact](/contact).\n\n![](https://cdn.example.com/x.png)",
  bodyFormat: "markdown",
  description: null,
  ogImage: null,
  published: true,
};

function mountEdit(dispatcher: Dispatcher): void {
  writes = [];
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[
        kumikoDefaultTranslations,
        templateResolverTranslations,
        defaultTranslations,
      ]}
    >
      <DispatcherProvider dispatcher={dispatcher}>
        <NavProvider
          value={{
            route: { screenId: "managed-pages:page-edit" },
            navigate: () => {},
            replace: () => {},
            hrefFor: () => "",
            searchParams: {},
            setSearchParams: () => {},
          }}
        >
          <PrimitivesProvider value={defaultPrimitives}>
            <UserRolesProvider roles={["TenantAdmin"]}>
              <ExtensionSectionsProvider value={{ [PAGE_BODY_EXTENSION_NAME]: PageBodySection }}>
                <KumikoScreen schema={schema} qn="managed-pages:screen:page-edit" entityId="p1" />
              </ExtensionSectionsProvider>
            </UserRolesProvider>
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

async function editBodyAndSave(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Bullet list" }));
  fireEvent.click(await screen.findByTestId("render-edit-submit"));
  await waitFor(() => expect(writes).toHaveLength(1));
}

afterEach(cleanup);

describe("page-edit body save", () => {
  test("a Markdown page with a relative link and an external image saves as a document", async () => {
    mountEdit(gatedDispatcher(MARKDOWN_RECORD));
    await editBodyAndSave();
    const [changes] = writes;
    expect(changes?.bodyFormat).toBe("document");
    expect(changes?.body).toContain("Contact");
    expect(changes?.body).not.toContain("/contact");
    expect(changes?.body).not.toContain("<img");
    await waitFor(() => expect(screen.queryByTestId("render-edit-form-error")).toBeNull());
  });

  test("a body the server rejects is shown to the user, not only a generic banner", async () => {
    mountEdit(gatedDispatcher(MARKDOWN_RECORD, rejection("script")));
    await editBodyAndSave();
    const banner = await screen.findByTestId("render-edit-form-error");
    expect(banner.textContent).toContain("script");
    expect(await screen.findByTestId("render-edit-form-error-unplaced")).toBeDefined();
  });
});
