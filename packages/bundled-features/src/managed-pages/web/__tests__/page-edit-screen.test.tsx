// The page workbench screen with the real body editor and the server's own body gate: a Markdown
// page converts to a document the gate accepts, a body the server rejects is shown, and a page is
// created or updated with one submit for settings and body.

import { afterEach, describe, expect, test } from "bun:test";
import {
  ContentPreviewsProvider,
  createStaticLocaleResolver,
  DispatcherProvider,
  hasUnsavedInput,
  kumikoDefaultTranslations,
  LocaleProvider,
  NavProvider,
  type PreviewRendererProps,
  PrimitivesProvider,
  UserRolesProvider,
} from "@cosmicdrift/kumiko-renderer";
import type { Dispatcher } from "@cosmicdrift/kumiko-renderer/headless";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { defaultTranslations as templateResolverTranslations } from "../../../template-resolver/web/i18n.ts";
import { BODY_REJECTED_I18N_KEY, sanitizePageBody } from "../../handlers/page-body-issues.ts";
import { PAGE_CREATE_HANDLER, PAGE_UPDATE_HANDLER } from "../constants.ts";
import { defaultTranslations } from "../default-translations.ts";
import { PageEditScreen } from "../page-edit-screen.tsx";

type Write = { type: string; payload: Record<string, unknown> };
let writes: Write[] = [];

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
    write: (async (type: string, payload: unknown) => {
      const sent = payload as Record<string, unknown>;
      writes.push({ type, payload: sent });
      if (forcedRejection !== undefined) return forcedRejection;
      const changes = (type === PAGE_CREATE_HANDLER ? sent : sent["changes"]) as {
        body?: string | null;
        bodyFormat?: string;
      };
      const gate = sanitizePageBody(changes.body, changes.bodyFormat);
      if (!gate.ok) return rejection(gate.issues[0]?.params?.["detail"] as string);
      return { isSuccess: true, data: { id: "new-page" } };
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

function WebPreviewStub({ content }: PreviewRendererProps): ReactNode {
  return <div data-testid="web-preview-stub">{content}</div>;
}

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

function mountEdit(
  dispatcher: Dispatcher,
  entityId: string | null = "p1",
  replace: () => void = () => {},
): void {
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
            route: { screenId: "page-edit", ...(entityId !== null && { entityId }) },
            navigate: () => {},
            replace,
            hrefFor: () => "",
            searchParams: {},
            setSearchParams: () => {},
          }}
        >
          <PrimitivesProvider value={defaultPrimitives}>
            <UserRolesProvider roles={["TenantAdmin"]}>
              <ContentPreviewsProvider value={{ web: WebPreviewStub }}>
                <PageEditScreen />
              </ContentPreviewsProvider>
            </UserRolesProvider>
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

async function editBodyAndSave(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Bullet list" }));
  fireEvent.click(await screen.findByTestId("editor-save"));
  await waitFor(() => expect(writes).toHaveLength(1));
}

function fill(label: RegExp, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

afterEach(cleanup);

describe("page workbench", () => {
  test("a Markdown page keeps its relative link and drops an external image on save", async () => {
    mountEdit(gatedDispatcher(MARKDOWN_RECORD));
    await editBodyAndSave();
    const [write] = writes;
    expect(write?.type).toBe(PAGE_UPDATE_HANDLER);
    const changes = write?.payload["changes"] as { body: string; bodyFormat: string };
    expect(changes.bodyFormat).toBe("document");
    expect(changes.body).toContain("Contact");
    expect(changes.body).toContain(`href="/contact"`);
    expect(changes.body).not.toContain("<img");
    expect(write?.payload["id"]).toBe("p1");
    expect(write?.payload["version"]).toBe(4);
    await waitFor(() => expect(screen.queryByTestId("page-workbench-save-error")).toBeNull());
  });

  test("a body the server rejects is shown to the user, not only a generic banner", async () => {
    mountEdit(gatedDispatcher(MARKDOWN_RECORD, rejection("script")));
    await editBodyAndSave();
    const banner = await screen.findByTestId("page-workbench-save-error");
    expect(banner.textContent).toContain("script");
  });

  test("changing only the title leaves a Markdown body and its format untouched", async () => {
    mountEdit(gatedDispatcher(MARKDOWN_RECORD));
    await screen.findByLabelText(/^title/i);
    fill(/^title/i, "About us");
    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.payload["changes"]).toEqual({ title: "About us" });
  });

  test("opening a Markdown page that loses content on conversion warns before any edit", async () => {
    mountEdit(gatedDispatcher(MARKDOWN_RECORD));
    expect((await screen.findByText(/external images/)).textContent).toContain("Converting it");
  });

  test("nothing can be saved before something changed", async () => {
    mountEdit(gatedDispatcher(MARKDOWN_RECORD));
    const save = await screen.findByTestId("editor-save");
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });

  test("a new page is created with settings and body in one write", async () => {
    mountEdit(gatedDispatcher(MARKDOWN_RECORD), null);
    fill(/^slug/i, "pricing");
    fill(/^title/i, "Pricing");
    fireEvent.click(await screen.findByRole("button", { name: "Bullet list" }));
    fireEvent.click(await screen.findByTestId("editor-save"));
    await waitFor(() => expect(writes).toHaveLength(1));
    const [write] = writes;
    expect(write?.type).toBe(PAGE_CREATE_HANDLER);
    expect(write?.payload).toMatchObject({
      slug: "pricing",
      lang: "en",
      title: "Pricing",
      published: false,
      bodyFormat: "document",
    });
  });

  test("after a successful create the leave guard already reports clean when the route is replaced", async () => {
    const unsavedAtReplace: boolean[] = [];
    mountEdit(gatedDispatcher(MARKDOWN_RECORD), null, () => {
      unsavedAtReplace.push(hasUnsavedInput());
    });
    fill(/^slug/i, "pricing");
    fill(/^title/i, "Pricing");
    fireEvent.click(await screen.findByRole("button", { name: "Bullet list" }));
    expect(hasUnsavedInput()).toBe(true);
    fireEvent.click(await screen.findByTestId("editor-save"));
    await waitFor(() => expect(unsavedAtReplace).toHaveLength(1));
    expect(unsavedAtReplace).toEqual([false]);
  });

  test("the preview mode mounts the web renderer with the draft body and shows the settings read-only", async () => {
    mountEdit(
      gatedDispatcher({ ...MARKDOWN_RECORD, body: "<p>Hello</p>", bodyFormat: "document" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Preview" }));
    expect((await screen.findByTestId("web-preview-stub")).textContent).toBe("<p>Hello</p>");
    expect(screen.getByTestId("page-workbench-rail-preview").textContent).toContain("/about");
    expect(screen.queryByLabelText(/^slug/i)).toBeNull();
  });
});
