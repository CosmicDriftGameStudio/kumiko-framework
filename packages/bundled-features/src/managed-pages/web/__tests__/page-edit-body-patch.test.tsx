// The page-edit screen has no `body`/`bodyFormat` layout fields any more: the
// body is an extension section. This renders the real screen and entity and
// proves that what the section patches ends up in the update command.

import { afterEach, describe, expect, test } from "bun:test";
import {
  type ButtonProps,
  type CorePrimitives,
  createStaticLocaleResolver,
  DispatcherProvider,
  type ExtensionSectionProps,
  ExtensionSectionsProvider,
  type FeatureSchema,
  type FormProps,
  KumikoScreen,
  kumikoDefaultTranslations,
  LocaleProvider,
  NavProvider,
  PrimitivesProvider,
  UserRolesProvider,
} from "@cosmicdrift/kumiko-renderer";
import type { Dispatcher } from "@cosmicdrift/kumiko-renderer/headless";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType, FormEvent, ReactNode } from "react";
import { pageEditScreen } from "../../screens/page-screens.ts";
import { pageEntity } from "../../table.ts";
import { PAGE_BODY_EXTENSION_NAME } from "../constants.ts";

let capturedFormSubmit: ((e?: FormEvent) => void) | undefined;
let lastWrite: { type: string; payload: unknown } | undefined;
const seenValues: Array<Readonly<Record<string, unknown>> | undefined> = [];

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;
const captureForm: ComponentType<FormProps> = (props) => {
  capturedFormSubmit = props.onSubmit;
  return <>{props.children}</>;
};
const domButton: ComponentType<ButtonProps> = (props) => (
  <button type="button" onClick={() => void props.onClick?.()}>
    {props.children}
  </button>
);

const testPrimitives: CorePrimitives = {
  Button: domButton,
  Banner: passChildren,
  Field: passChildren,
  Input: noop,
  DataTable: noop,
  Form: captureForm,
  Section: passChildren,
  Card: passChildren,
  Grid: passChildren,
  GridCell: passChildren,
  Text: passChildren,
  Heading: noop,
  Dialog: noop,
  Modal: noop,
  Lightbox: noop,
  ConfigSourceBadge: noop,
  ConfigCascadeView: noop,
  Link: noop,
};

// Stands in for PageBodySection: the document editor itself needs a real
// browser, the contract under test is the patch that reaches the form.
function StubBodySection({ values, patch }: ExtensionSectionProps): ReactNode {
  seenValues.push(values);
  return (
    <button
      type="button"
      onClick={() => patch?.({ body: "<p>edited</p>", bodyFormat: "document" })}
    >
      edit body
    </button>
  );
}

function stubDispatcher(record: Readonly<Record<string, unknown>>): Dispatcher {
  return {
    write: (async (type: string, payload: unknown) => {
      lastWrite = { type, payload };
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
  body: "# About\n\nText",
  bodyFormat: "markdown",
  description: null,
  ogImage: null,
  published: true,
};

function mountEdit(record: Readonly<Record<string, unknown>>): void {
  lastWrite = undefined;
  capturedFormSubmit = undefined;
  seenValues.length = 0;
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={stubDispatcher(record)}>
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
          <PrimitivesProvider value={testPrimitives}>
            <UserRolesProvider roles={["TenantAdmin"]}>
              <ExtensionSectionsProvider value={{ [PAGE_BODY_EXTENSION_NAME]: StubBodySection }}>
                <KumikoScreen schema={schema} qn="managed-pages:screen:page-edit" entityId="p1" />
              </ExtensionSectionsProvider>
            </UserRolesProvider>
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

async function submit(): Promise<{ type: string; payload: unknown }> {
  await waitFor(() => {
    expect(capturedFormSubmit).toBeDefined();
  });
  act(() => capturedFormSubmit?.());
  await waitFor(() => {
    expect(lastWrite).toBeDefined();
  });
  if (lastWrite === undefined) throw new Error("expected a write() call");
  return lastWrite;
}

afterEach(cleanup);

describe("page-edit body extension section", () => {
  test("the section sees the stored body and bodyFormat", async () => {
    mountEdit(MARKDOWN_RECORD);
    await screen.findByRole("button", { name: "edit body" });
    const values = seenValues.at(-1);
    expect(values?.["body"]).toBe("# About\n\nText");
    expect(values?.["bodyFormat"]).toBe("markdown");
  });

  test("saving without touching the section sends neither body nor bodyFormat", async () => {
    mountEdit(MARKDOWN_RECORD);
    await screen.findByRole("button", { name: "edit body" });
    const write = await submit();
    const changes = (write.payload as { changes: Record<string, unknown> }).changes;
    expect(Object.hasOwn(changes, "body")).toBe(false);
    expect(Object.hasOwn(changes, "bodyFormat")).toBe(false);
  });

  test("a patch of body and bodyFormat lands in the update command's changes", async () => {
    mountEdit(MARKDOWN_RECORD);
    const edit = await screen.findByRole("button", { name: "edit body" });
    act(() => edit.click());
    const write = await submit();
    expect(write.type).toBe("managed-pages:write:page:update");
    expect(write.payload).toMatchObject({
      id: "p1",
      version: 4,
      changes: { body: "<p>edited</p>", bodyFormat: "document" },
    });
  });
});
