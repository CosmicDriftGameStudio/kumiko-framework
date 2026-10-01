// entityList `expandableRow`: the area under a row is a relatedList of that
// row's record. Renders the real path (KumikoScreen → EntityListBody →
// RenderList → EntityListExpandedRow → RelatedListSection) under a stub
// dispatcher that records every query() call per QN, behind a DataTable stub
// that drives the three expansion props the way the web table does.

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.js";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.js";
import { kumikoDefaultTranslations } from "../../i18n-defaults.js";
import {
  type ButtonProps,
  type CorePrimitives,
  type DataTableProps,
  PrimitivesProvider,
} from "../../primitives.js";
import type { FeatureSchema } from "../feature-schema.js";
import { KumikoScreen } from "../kumiko-screen.js";
import { NavProvider } from "../nav.js";

const PARENT_QN = "campaigns:query:campaign:list";
const CHILD_QN = "campaigns:query:campaign-post:list";

type QueryCall = { readonly qn: string; readonly payload: Record<string, unknown> };

let queryCalls: QueryCall[] = [];
let writeIsSuccess = true;

function callsFor(qn: string): readonly QueryCall[] {
  return queryCalls.filter((c) => c.qn === qn);
}

function parentIdOf(payload: Record<string, unknown>): string {
  const filter = payload["filter"] as { readonly value?: unknown } | undefined;
  return String(filter?.value ?? "");
}

function stubDispatcher(): Dispatcher {
  return {
    write: (async () => {
      if (!writeIsSuccess) {
        return {
          isSuccess: false,
          error: {
            code: "unknown",
            httpStatus: 500,
            i18nKey: "kumiko:error:unknown",
            message: "boom",
          },
        };
      }
      return { isSuccess: true, data: {} };
    }) as unknown as Dispatcher["write"],
    query: (async (qn: string, payload: Record<string, unknown>) => {
      queryCalls.push({ qn, payload });
      if (qn === CHILD_QN) {
        const parent = parentIdOf(payload);
        return {
          isSuccess: true,
          data: {
            rows: [{ id: `post-of-${parent}`, datum: "2026-10-01", campaign: parent }],
            nextCursor: null,
            total: 1,
          },
        };
      }
      return {
        isSuccess: true,
        data: {
          rows: [
            { id: "campaign-1", name: "Spring" },
            { id: "campaign-2", name: "Summer" },
          ],
          nextCursor: null,
          total: 2,
        },
      };
    }) as unknown as Dispatcher["query"],
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

// Mirrors the web table's contract: a toggle per row, the expansion rendered
// under an open row, and row actions as plain buttons.
const ExpandingTable: ComponentType<DataTableProps> = (props) => (
  <div>
    {props.rows.map((row) => (
      <div key={row.id} data-testid={`row-${row.id}`}>
        {props.renderExpandedRow !== undefined && (
          <button
            type="button"
            data-testid={`toggle-${row.id}`}
            aria-expanded={props.expandedRowIds?.has(row.id) === true}
            onClick={() => props.onToggleRowExpanded?.(row.id)}
          />
        )}
        {(props.rowActions ?? []).map((action) => (
          <button
            key={action.id}
            type="button"
            data-testid={`action-${row.id}-${action.id}`}
            onClick={() => {
              Promise.resolve(action.onTrigger(row)).catch(() => {});
            }}
          />
        ))}
        {props.expandedRowIds?.has(row.id) === true && (
          <div data-testid={`expansion-${row.id}`}>{props.renderExpandedRow?.(row)}</div>
        )}
      </div>
    ))}
  </div>
);

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;
const TestButton: ComponentType<ButtonProps> = ({ children, onClick, testId }) => (
  <button type="button" data-testid={testId} onClick={() => void onClick?.()}>
    {children}
  </button>
);

const testPrimitives: CorePrimitives = {
  Button: TestButton,
  Banner: passChildren,
  Field: passChildren,
  Input: noop,
  DataTable: ExpandingTable,
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
};

function buildSchema(withExpandableRow: boolean): FeatureSchema {
  const entity: EntityDefinition = {
    fields: {
      name: { type: "text", maxLength: 50, required: false, searchable: false, sortable: false },
    },
  };
  const listScreen: EntityListScreenDefinition = {
    id: "campaign-list",
    type: "entityList",
    entity: "campaign",
    columns: ["name"],
    ...(withExpandableRow && {
      expandableRow: {
        kind: "relatedList",
        title: "Posts",
        query: CHILD_QN,
        parentFilter: { field: "campaign" },
        columns: [{ field: "datum", label: "Date" }],
        rowActions: [
          {
            kind: "writeHandler",
            id: "mark-posted",
            label: "Mark posted",
            handler: "campaigns:write:campaign-post:mark-posted",
          },
        ],
      },
    }),
  };
  return {
    featureName: "campaigns",
    entities: { campaign: entity },
    screens: [listScreen],
  } as FeatureSchema;
}

function renderListScreen(withExpandableRow = true): void {
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "de-DE" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={stubDispatcher()}>
        <NavProvider
          value={{
            route: { screenId: "campaigns:campaign-list" },
            navigate: () => {},
            replace: () => {},
            hrefFor: () => "",
            searchParams: {},
            setSearchParams: () => {},
          }}
        >
          <PrimitivesProvider value={testPrimitives}>
            <KumikoScreen
              schema={buildSchema(withExpandableRow)}
              qn="campaigns:screen:campaign-list"
            />
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

async function mountedParentList(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId("row-campaign-1")).toBeDefined();
  });
}

function resetState(): void {
  queryCalls = [];
  writeIsSuccess = true;
}

describe("entityList expandableRow", () => {
  test("a screen without expandableRow wires no expansion props", async () => {
    resetState();
    renderListScreen(false);
    await mountedParentList();
    expect(screen.queryByTestId("toggle-campaign-1")).toBeNull();
  });

  test("a closed row loads nothing; opening it queries the sub-list with the row id as parent", async () => {
    resetState();
    renderListScreen();
    await mountedParentList();
    expect(callsFor(CHILD_QN)).toHaveLength(0);

    fireEvent.click(screen.getByTestId("toggle-campaign-1"));

    await waitFor(() => {
      expect(screen.getByTestId("action-post-of-campaign-1-mark-posted")).toBeDefined();
    });
    expect(callsFor(CHILD_QN)).toHaveLength(1);
    expect(parentIdOf(callsFor(CHILD_QN)[0]?.payload ?? {})).toBe("campaign-1");
    expect(screen.getByTestId("toggle-campaign-1").getAttribute("aria-expanded")).toBe("true");
  });

  test("several rows stay open at once and closing one leaves the other", async () => {
    resetState();
    renderListScreen();
    await mountedParentList();

    fireEvent.click(screen.getByTestId("toggle-campaign-1"));
    fireEvent.click(screen.getByTestId("toggle-campaign-2"));
    await waitFor(() => {
      expect(screen.getByTestId("action-post-of-campaign-2-mark-posted")).toBeDefined();
    });
    expect(screen.getByTestId("expansion-campaign-1")).toBeDefined();

    fireEvent.click(screen.getByTestId("toggle-campaign-1"));
    expect(screen.queryByTestId("expansion-campaign-1")).toBeNull();
    expect(screen.getByTestId("expansion-campaign-2")).toBeDefined();
  });

  test("a successful sub-list write refetches the sub-list and the parent list", async () => {
    resetState();
    renderListScreen();
    await mountedParentList();
    fireEvent.click(screen.getByTestId("toggle-campaign-1"));
    const action = await waitFor(() => screen.getByTestId("action-post-of-campaign-1-mark-posted"));
    const parentBefore = callsFor(PARENT_QN).length;
    const childBefore = callsFor(CHILD_QN).length;

    await act(async () => {
      fireEvent.click(action);
    });

    await waitFor(() => {
      expect(callsFor(CHILD_QN)).toHaveLength(childBefore + 1);
      expect(callsFor(PARENT_QN)).toHaveLength(parentBefore + 1);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(callsFor(CHILD_QN)).toHaveLength(childBefore + 1);
    expect(callsFor(PARENT_QN)).toHaveLength(parentBefore + 1);
  });

  test("a failed sub-list write refetches neither list", async () => {
    resetState();
    renderListScreen();
    await mountedParentList();
    fireEvent.click(screen.getByTestId("toggle-campaign-1"));
    const action = await waitFor(() => screen.getByTestId("action-post-of-campaign-1-mark-posted"));
    const parentBefore = callsFor(PARENT_QN).length;
    const childBefore = callsFor(CHILD_QN).length;
    writeIsSuccess = false;

    await act(async () => {
      fireEvent.click(action);
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(callsFor(CHILD_QN)).toHaveLength(childBefore);
    expect(callsFor(PARENT_QN)).toHaveLength(parentBefore);
  });
});
