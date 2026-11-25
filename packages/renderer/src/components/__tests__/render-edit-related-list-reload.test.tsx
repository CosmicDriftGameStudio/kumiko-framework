// A row action in a relatedList section can change the host record (a handler
// setting a field the header actions' visibility depends on), so RenderEdit
// reloads the host after the write, unless the form holds unsaved input.
// Either way the list itself queries exactly once per row write.

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { act, fireEvent, render, screen as rtlScreen, waitFor } from "@testing-library/react";
import { type ComponentType, type ReactNode, useState } from "react";
import { type NavApi, NavProvider } from "../../app/nav.tsx";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { kumikoDefaultTranslations } from "../../i18n-defaults.ts";
import { type DataTableProps, type InputProps, PrimitivesProvider } from "../../primitives.tsx";
import { createMockDispatcher, createStubPrimitives } from "../../testing.ts";
import { RenderEdit } from "../render-edit.tsx";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const entity: EntityDefinition = {
  name: "entity",
  fields: {
    name: {
      type: "text",
      allowPlaintext: "test fixture value, not personal data",
      maxLength: 200,
      required: false,
      searchable: false,
      sortable: false,
    },
  },
};

const rowActionTable: ComponentType<DataTableProps> = ({ rows, rowActions, rowStruck }) => (
  <div>
    {rows.map((row) => (
      <div
        key={row.id}
        data-testid={`row-${row.id}`}
        data-struck={String(rowStruck?.(row) === true)}
      >
        {(rowActions ?? []).map((action) => (
          <button
            key={action.id}
            type="button"
            data-testid={`action-${action.id}-${row.id}`}
            onClick={() => void action.onTrigger(row)}
          >
            {action.label}
          </button>
        ))}
      </div>
    ))}
  </div>
);

const textInput = (props: InputProps): ReactNode =>
  props.kind === "text" ? (
    <input
      data-testid={props.id}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  ) : null;

const nav: NavApi = {
  route: undefined,
  navigate: () => {},
  replace: () => {},
  hrefFor: () => "#",
  searchParams: {},
  setSearchParams: () => {},
};

const screen: EntityEditScreenDefinition = {
  id: "widget-edit",
  type: "entityEdit",
  entity: "widget",
  layout: {
    sections: [
      { title: "Basics", fields: ["name"] },
      {
        kind: "relatedList",
        title: "Positions",
        query: "widgets:query:positions:list",
        columns: [{ field: "name" }],
        struckWhen: { field: "name", eq: "Lost position" },
        rowActions: [
          {
            id: "undo",
            label: "actions.undo",
            handler: "widgets:write:undo",
            payload: { pick: ["id"] },
          },
        ],
      },
    ],
  },
};

// Mirrors projectionDetail: a host reload bumps the refreshToken the lists watch.
function Host({ onReload }: { readonly onReload: () => void }): ReactNode {
  const [nonce, setNonce] = useState(0);
  return (
    <RenderEdit
      screen={screen}
      entity={entity}
      featureName="widgets"
      entityId="widget-1"
      initial={{ name: "" }}
      refreshToken={nonce}
      onReload={() => {
        onReload();
        setNonce((n) => n + 1);
      }}
    />
  );
}

function setup() {
  const writes: string[] = [];
  let listQueries = 0;
  let reloads = 0;
  const dispatcher = createMockDispatcher({
    write: async (type) => {
      writes.push(type);
      return { isSuccess: true, data: null };
    },
    query: async () => {
      listQueries += 1;
      return {
        isSuccess: true,
        data: {
          rows: [
            { id: "r1", name: "Position" },
            { id: "r2", name: "Lost position" },
          ],
          nextCursor: null,
        },
      };
    },
    batch: async () => ({ isSuccess: true, results: [] }),
  });
  const primitives = createStubPrimitives({
    Button: noop,
    Banner: noop,
    Field: passChildren,
    Input: textInput,
    DataTable: rowActionTable,
    Form: passChildren,
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
  });
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={dispatcher}>
        <PrimitivesProvider value={primitives}>
          <NavProvider value={nav}>
            <Host
              onReload={() => {
                reloads += 1;
              }}
            />
          </NavProvider>
        </PrimitivesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
  return { writes, listQueries: () => listQueries, reloads: () => reloads };
}

describe("RenderEdit relatedList row actions", () => {
  test("a writeHandler row action reloads the host once and queries the list once", async () => {
    const run = setup();
    await waitFor(() => rtlScreen.getByTestId("action-undo-r1"));
    expect(run.listQueries()).toBe(1);

    rtlScreen.getByTestId("action-undo-r1").click();

    await waitFor(() => expect(run.writes).toEqual(["widgets:write:undo"]));
    await waitFor(() => expect(run.reloads()).toBe(1));
    await settle();
    expect(run.listQueries()).toBe(2);
    expect(run.reloads()).toBe(1);
  });

  test("with unsaved input the host is not reloaded, the input stays and the list still queries once", async () => {
    const run = setup();
    await waitFor(() => rtlScreen.getByTestId("action-undo-r1"));
    const input = rtlScreen.getByTestId("kumiko-edit-name");
    fireEvent.change(input, { target: { value: "draft" } });

    rtlScreen.getByTestId("action-undo-r1").click();

    await waitFor(() => expect(run.writes).toEqual(["widgets:write:undo"]));
    await settle();
    expect(run.listQueries()).toBe(2);
    expect(run.reloads()).toBe(0);
    expect((rtlScreen.getByTestId("kumiko-edit-name") as HTMLInputElement).value).toBe("draft");
  });

  test("struckWhen reaches the table and strikes only the matching rows", async () => {
    setup();
    await waitFor(() => rtlScreen.getByTestId("row-r2"));
    expect(rtlScreen.getByTestId("row-r2").getAttribute("data-struck")).toBe("true");
    expect(rtlScreen.getByTestId("row-r1").getAttribute("data-struck")).toBe("false");
  });
});

// Lets the refetches a write triggers (host reload, token change, list query) run to the end.
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}
