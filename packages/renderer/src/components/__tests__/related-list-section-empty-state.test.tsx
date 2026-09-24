// EditRelatedListSection.emptyState (fw#3234) — forwarded to the DataTable's
// own `emptyState` prop, rendered as title/description plus an optional
// record-bound action dispatched the same way a toolbarAction is.

import { describe, expect, test } from "bun:test";
import type { EditRelatedListSectionViewModel } from "@cosmicdrift/kumiko-headless";
import { fireEvent, render, screen as rtlScreen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { NavProvider } from "../../app/nav";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import {
  type ButtonProps,
  type CorePrimitives,
  type DataTableProps,
  PrimitivesProvider,
  type TextProps,
} from "../../primitives";
import { RelatedListSection } from "../related-list-section";

const noop = () => {};
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const testDataTable: ComponentType<DataTableProps> = ({ rows, emptyState }) =>
  rows.length === 0 && emptyState !== undefined ? <div>{emptyState}</div> : <table />;

function testPrimitives(): CorePrimitives {
  return {
    Button: (props: ButtonProps) => (
      <button type="button" data-testid={props.testId} onClick={() => void props.onClick?.()}>
        {props.children}
      </button>
    ),
    Banner: passChildren,
    Field: passChildren,
    Input: noop,
    DataTable: testDataTable,
    Form: noop,
    Section: passChildren,
    Card: passChildren,
    Grid: passChildren,
    GridCell: passChildren,
    Text: ({ children }: TextProps) => <span>{children}</span>,
    Heading: noop,
    Dialog: noop,
    Modal: noop,
    Lightbox: noop,
    ConfigSourceBadge: noop,
    ConfigCascadeView: noop,
    Link: noop,
  } as unknown as CorePrimitives;
}

const baseSection: EditRelatedListSectionViewModel = {
  kind: "relatedList",
  title: "Notifications",
  query: "orders:query:notifications:list",
  columns: [{ field: "name" }],
};

function renderEmpty(
  section: EditRelatedListSectionViewModel,
  onWrite?: (type: string, payload: unknown) => void,
) {
  const dispatcher = {
    write: (async (type: string, payload: unknown) => {
      onWrite?.(type, payload);
      return { isSuccess: true, data: null };
    }) as never,
    query: (async () => ({ isSuccess: true, data: { rows: [], nextCursor: null } })) as never,
    batch: (async () => ({ isSuccess: true, results: [] })) as never,
    statusStore: { getState: () => "online", subscribe: () => () => {} } as never,
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
  return render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={dispatcher}>
        <PrimitivesProvider value={testPrimitives()}>
          <NavProvider
            value={{
              route: undefined,
              navigate: noop,
              replace: noop,
              hrefFor: () => "#",
              searchParams: {},
              setSearchParams: noop,
            }}
          >
            <RelatedListSection
              section={section}
              parentId="order-1"
              record={{ id: "order-1" }}
              featureName="orders"
            />
          </NavProvider>
        </PrimitivesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

describe("RelatedListSection — emptyState (fw#3234)", () => {
  test("no emptyState declared: DataTable renders its own fallback, not a custom one", async () => {
    renderEmpty(baseSection);
    await waitFor(() => rtlScreen.getByRole("table"));
    expect(rtlScreen.queryByText("No notifications yet")).toBeNull();
  });

  test("custom emptyState renders title, description, and dispatches its action's payload evaluated against the parent record", async () => {
    const writes: Array<{ type: string; payload: unknown }> = [];
    const section: EditRelatedListSectionViewModel = {
      ...baseSection,
      emptyState: {
        title: "No notifications yet",
        description: "New ones show up here.",
        action: {
          kind: "writeHandler",
          id: "seed",
          label: "actions.seed",
          handler: "orders:write:seed-notifications",
          payload: { pick: ["id"] },
        },
      },
    };
    renderEmpty(section, (type, payload) => writes.push({ type, payload }));

    await waitFor(() => rtlScreen.getByText("No notifications yet"));
    expect(rtlScreen.getByText("New ones show up here.")).toBeTruthy();

    fireEvent.click(rtlScreen.getByTestId("render-edit-action-seed"));
    await waitFor(() => expect(writes.length).toBe(1));
    expect(writes[0]).toEqual({
      type: "orders:write:seed-notifications",
      payload: { id: "order-1" },
    });
  });
});
