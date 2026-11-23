// The draft editor against a scripted dispatcher: which write carries which base, when finalize
// is blocked, and where the screen goes after finalize.

import { afterEach, describe, expect, test } from "bun:test";
import {
  AppFeaturesProvider,
  ContentPreviewsProvider,
  createStaticLocaleResolver,
  DispatcherProvider,
  type FeatureSchema,
  kumikoDefaultTranslations,
  LocaleProvider,
  NavProvider,
  type PreviewRendererProps,
  PrimitivesProvider,
  UserRolesProvider,
} from "@cosmicdrift/kumiko-renderer";
import type { Dispatcher } from "@cosmicdrift/kumiko-renderer/headless";
import { createMockDispatcher } from "@cosmicdrift/kumiko-renderer/testing";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { defaultTranslations as templateResolverTranslations } from "../../../template-resolver/web/i18n.ts";
import { DocumentDraftHandlers } from "../constants.ts";
import { DocumentDraftEditorScreen } from "../editor-screen.tsx";
import { defaultTranslations } from "../i18n.ts";

type Write = { type: string; payload: Record<string, unknown> };
let writes: Write[] = [];
let navigated: { screenId: string; entityId?: string }[] = [];

const OPEN_DRAFT = {
  id: "d1",
  subjectType: "lease",
  subjectId: "lease-7",
  subjectScreen: "lease-detail",
  finalizable: true,
  templateSlug: "lease-contract",
  templateTitle: null,
  locale: "en",
  templateVariant: "furnished",
  status: "open",
  revision: 2,
  version: 5,
  fileRefId: null,
  fileName: null,
  body: "<p>Rent {{rent}}</p>",
  variables: { rent: "900" },
  variableSchema: { rent: { type: "text" } },
  deviations: [
    { change: "same", content: "<p>Intro</p>" },
    { change: "added", content: "<p>Pets allowed</p>" },
  ],
};

function dispatcherFor(record: Readonly<Record<string, unknown>>): Dispatcher {
  return createMockDispatcher({
    write: async (type: string, payload: unknown) => {
      writes.push({ type, payload: payload as Record<string, unknown> });
      return { isSuccess: true, data: { id: "d1" } };
    },
    query: async (type: string) => ({
      isSuccess: true,
      data:
        type === "config:query:values"
          ? { "tenant-settings:config:currency": { value: "GBP", scope: "tenant" } }
          : record,
    }),
    batch: async () => ({ isSuccess: true, results: [] }),
  });
}

function WebPreviewStub({ content }: PreviewRendererProps): ReactNode {
  return <div data-testid="web-preview-stub">{content}</div>;
}

const RETURN_FEATURES: readonly FeatureSchema[] = [
  {
    featureName: "billing",
    entities: {},
    screens: [
      { id: "billing:screen:dispatch", type: "custom", access: { roles: ["TenantAdmin"] } },
    ],
  } as unknown as FeatureSchema,
];

function mountEditor(
  record: Readonly<Record<string, unknown>>,
  searchParams: Readonly<Record<string, string>> = {},
): void {
  writes = [];
  navigated = [];
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[
        kumikoDefaultTranslations,
        templateResolverTranslations,
        defaultTranslations,
      ]}
    >
      <DispatcherProvider dispatcher={dispatcherFor(record)}>
        <NavProvider
          value={{
            route: { screenId: "document-draft-editor", entityId: "d1" },
            navigate: (target) => {
              if ("screenId" in target) navigated.push(target);
            },
            replace: () => {},
            hrefFor: () => "",
            searchParams,
            setSearchParams: () => {},
          }}
        >
          <PrimitivesProvider value={defaultPrimitives}>
            <UserRolesProvider roles={["TenantAdmin"]}>
              <AppFeaturesProvider features={RETURN_FEATURES}>
                <ContentPreviewsProvider value={{ web: WebPreviewStub }}>
                  <DocumentDraftEditorScreen />
                </ContentPreviewsProvider>
              </AppFeaturesProvider>
            </UserRolesProvider>
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

async function makeDirty(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Bullet list" }));
}

afterEach(cleanup);

describe("document draft editor", () => {
  test("an open draft shows status, template, revision and the deviations from the template", async () => {
    mountEditor(OPEN_DRAFT);
    expect((await screen.findByTestId("document-draft-workbench-status")).textContent).toBe("Open");
    const rail = screen.getByTestId("document-draft-workbench-rail-template");
    expect(rail.textContent).toContain("lease-contract");
    expect(rail.textContent).toContain("furnished");
    const deviations = screen.getAllByTestId("document-draft-workbench-rail-deviation");
    expect(deviations).toHaveLength(1);
    expect(deviations[0]?.textContent).toContain("Pets allowed");
  });

  test("the template title replaces the raw slugs in the header and the rail", async () => {
    mountEditor({ ...OPEN_DRAFT, templateTitle: "Lease contract (furnished)" });
    expect((await screen.findAllByText("Lease contract (furnished)")).length).toBeGreaterThan(0);
    const rail = screen.getByTestId("document-draft-workbench-rail-template");
    expect(rail.textContent).toContain("Lease contract (furnished)");
    expect(rail.textContent).not.toContain("lease-contract");
    expect(screen.queryByText("Variant")).toBeNull();
  });

  test("a money placeholder chip shows the formatted amount in the tenant currency", async () => {
    mountEditor({
      ...OPEN_DRAFT,
      body: '<p>Rent <span data-variable="rent"></span></p>',
      variables: { rent: 85000 },
      variableSchema: { rent: { type: "money" } },
    });
    await screen.findByText("£850.00");
    expect(screen.queryByText("85000")).toBeNull();
  });

  test("a rich text placeholder chip shows the text, not the markup", async () => {
    mountEditor({
      ...OPEN_DRAFT,
      body: '<p><span data-variable="intro"></span></p>',
      variables: { intro: "<p>Here is your <strong>statement</strong> &amp; receipts.</p>" },
      variableSchema: { intro: { type: "richText" } },
    });
    await screen.findByText("Here is your statement & receipts.");
    expect(screen.queryByText(/<p>/)).toBeNull();
  });

  test("a placeholder chip without a value shows the variable label, with a value the formatted value", async () => {
    mountEditor({
      ...OPEN_DRAFT,
      body: '<p><span data-variable="endDate"></span> <span data-variable="rent"></span> <span data-variable="tenantName"></span></p><table><tbody><tr data-each="steps"><td><p><span data-variable="validFrom"></span></p></td></tr></tbody></table>',
      variables: { rent: 85000 },
      variableSchema: {
        endDate: { type: "date", label: "End of lease" },
        rent: { type: "money" },
        steps: { type: "list", item: { validFrom: { type: "date", label: "Valid from" } } },
      },
    });
    await screen.findByText("£850.00");
    screen.getByText("End of lease");
    screen.getByText("Company name");
    screen.getByText("Valid from");
    expect(screen.queryByText("validFrom")).toBeNull();
    expect(screen.queryByText("endDate")).toBeNull();
    expect(screen.queryByText("tenantName")).toBeNull();
  });

  test("a draft equal to its template says so instead of listing deviations", async () => {
    mountEditor({ ...OPEN_DRAFT, deviations: [{ change: "same", content: "<p>Intro</p>" }] });
    await screen.findByText("The draft matches the template.");
    expect(screen.queryByTestId("document-draft-workbench-rail-deviation")).toBeNull();
  });

  test("saving writes the editor content with the version the draft was read at", async () => {
    mountEditor(OPEN_DRAFT);
    await makeDirty();
    fireEvent.click(await screen.findByTestId("editor-save"));
    await waitFor(() => expect(writes).toHaveLength(1));
    const [write] = writes;
    expect(write?.type).toBe(DocumentDraftHandlers.save);
    expect(write?.payload["id"]).toBe("d1");
    expect(write?.payload["base"]).toBe(5);
    expect(String(write?.payload["content"])).toContain("<ul");
  });

  test("finalize is blocked while there are unsaved changes", async () => {
    mountEditor(OPEN_DRAFT);
    const finalize = await screen.findByTestId("document-draft-workbench-finalize");
    expect((finalize as HTMLButtonElement).disabled).toBe(false);
    await makeDirty();
    await waitFor(() => expect((finalize as HTMLButtonElement).disabled).toBe(true));
    expect(writes).toHaveLength(0);
  });

  test("finalize writes with the base and returns to the screen of the subject", async () => {
    mountEditor(OPEN_DRAFT);
    fireEvent.click(await screen.findByTestId("document-draft-workbench-finalize"));
    await waitFor(() => expect(navigated).toHaveLength(1));
    expect(writes).toEqual([
      { type: DocumentDraftHandlers.finalize, payload: { id: "d1", base: 5 } },
    ]);
    expect(navigated[0]).toEqual({ screenId: "lease-detail", entityId: "lease-7" });
  });

  test("with a returnTo the editor offers Back, which navigates there; without one there is no Back", async () => {
    mountEditor(OPEN_DRAFT, { returnTo: "dispatch" });
    fireEvent.click(await screen.findByTestId("document-draft-workbench-back"));
    await waitFor(() => expect(navigated).toEqual([{ screenId: "dispatch" }]));
    cleanup();
    mountEditor(OPEN_DRAFT);
    await screen.findByTestId("document-draft-workbench-finalize");
    expect(screen.queryByTestId("document-draft-workbench-back")).toBeNull();
  });

  test("a returnTo wins over the subject screen after finalize", async () => {
    mountEditor(OPEN_DRAFT, { returnTo: "dispatch" });
    fireEvent.click(await screen.findByTestId("document-draft-workbench-finalize"));
    await waitFor(() => expect(navigated).toEqual([{ screenId: "dispatch" }]));
  });

  test("a draft that is not finalizable shows no finalize button but still discard", async () => {
    mountEditor({ ...OPEN_DRAFT, finalizable: false });
    await screen.findByTestId("document-draft-workbench-discard");
    expect(screen.queryByTestId("document-draft-workbench-finalize")).toBeNull();
  });

  test("without a subject screen finalize stays on the draft", async () => {
    mountEditor({ ...OPEN_DRAFT, subjectScreen: null });
    fireEvent.click(await screen.findByTestId("document-draft-workbench-finalize"));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(navigated).toHaveLength(0);
  });

  test("a finalized draft is read-only with its file name and offers to edit again", async () => {
    mountEditor({ ...OPEN_DRAFT, status: "finalized", fileName: "lease.pdf" });
    const revise = await screen.findByRole("button", { name: "Edit again" });
    expect(screen.queryByTestId("document-draft-workbench-finalize")).toBeNull();
    expect((await screen.findByTestId("document-draft-workbench-rail-file")).textContent).toContain(
      "lease.pdf",
    );
    fireEvent.click(revise);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      type: DocumentDraftHandlers.revise,
      payload: { id: "d1", base: 5 },
    });
  });
});
