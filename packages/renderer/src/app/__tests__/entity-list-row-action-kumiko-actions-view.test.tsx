// fw-i18n-funde: user-data-rights's export-job-list screen (bundled-features/
// src/user-data-rights/screens.ts) ships a `navigate` row action labelled
// "kumiko.actions.view", following the same `kumiko.actions.*` convention as
// tenant/screens.ts and user/screens.ts (e.g. "kumiko.actions.edit"). Unlike
// those, "kumiko.actions.view" was never declared in the framework's default
// bundle (renderer/src/i18n-defaults.ts) — every mounting app rendered the
// raw key instead of a translated label. This renders the real entityList
// pipeline (KumikoScreen → EntityListBody) against the framework's own
// kumikoDefaultTranslations, mirroring entity-list-row-action-refetch.test.tsx's
// harness, and asserts the row action resolves to actual text.

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { render, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import {
  type CorePrimitives,
  type DataTableProps,
  type DataTableRowAction,
  PrimitivesProvider,
} from "../../primitives";
import type { FeatureSchema } from "../feature-schema";
import { KumikoScreen } from "../kumiko-screen";
import { NavProvider } from "../nav";

function stubDispatcher(): Dispatcher {
  return {
    write: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"],
    query: (async () => ({
      isSuccess: true,
      data: { rows: [{ id: "job-1", status: "completed" }], nextCursor: null, total: 1 },
    })) as unknown as Dispatcher["query"],
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

let capturedRowActions: readonly DataTableRowAction[] | undefined;
const captureDataTable: ComponentType<DataTableProps> = (props) => {
  capturedRowActions = props.rowActions;
  return null;
};
const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const testPrimitives: CorePrimitives = {
  Button: noop,
  Banner: passChildren,
  Field: passChildren,
  Input: noop,
  DataTable: captureDataTable,
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

function buildSchema(): FeatureSchema {
  const entity: EntityDefinition = {
    fields: {
      status: {
        type: "text",
        maxLength: 50,
        required: false,
        searchable: false,
        sortable: false,
      },
    },
  };
  // Mirrors user-data-rights's export-job-list rowAction verbatim (kind,
  // label key, entityId) — only ids/entity/screen are renamed for the fixture.
  const listScreen: EntityListScreenDefinition = {
    id: "export-job-list",
    type: "entityList",
    entity: "export-job",
    columns: ["status"],
    rowActions: [
      {
        kind: "navigate",
        id: "view",
        label: "kumiko.actions.view",
        screen: "export-job-detail",
        entityId: "id",
      },
    ],
  };
  return {
    featureName: "user-data-rights",
    entities: { "export-job": entity },
    screens: [listScreen],
  } as FeatureSchema;
}

function renderListScreen(): void {
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={stubDispatcher()}>
        <NavProvider
          value={{
            route: { screenId: "user-data-rights:export-job-list" },
            navigate: () => {},
            replace: () => {},
            hrefFor: () => "",
            searchParams: {},
            setSearchParams: () => {},
          }}
        >
          <PrimitivesProvider value={testPrimitives}>
            <KumikoScreen schema={buildSchema()} qn="user-data-rights:screen:export-job-list" />
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

function requireViewAction(): DataTableRowAction {
  const action = capturedRowActions?.find((a) => a.id === "view");
  if (!action) throw new Error("expected the 'view' row action to be captured");
  return action;
}

describe("entityList navigate row-action renders the framework's kumiko.actions.* labels", () => {
  test("kumiko.actions.view resolves to real text, not the raw key", async () => {
    capturedRowActions = undefined;

    renderListScreen();

    await waitFor(() => {
      expect(capturedRowActions).toBeDefined();
    });

    const viewAction = requireViewAction();
    expect(viewAction.label).not.toBe("kumiko.actions.view");
    expect(viewAction.label).toBe("View");
  });
});
