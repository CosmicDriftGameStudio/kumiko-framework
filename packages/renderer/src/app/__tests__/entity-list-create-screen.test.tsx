import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { render, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.js";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.js";
import {
  type ButtonProps,
  type CorePrimitives,
  type DataTableProps,
  PrimitivesProvider,
} from "../../primitives.js";
import type { FeatureSchema } from "../feature-schema.js";
import { KumikoScreen } from "../kumiko-screen.js";
import { NavProvider, type NavTarget } from "../nav.js";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

function stubDispatcher(): Dispatcher {
  return {
    write: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"],
    query: (async () => ({
      isSuccess: true,
      data: { rows: [], total: 0 },
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

function buildSchema(createScreen: string | undefined, createUnavailable = false): FeatureSchema {
  const entity: EntityDefinition = {
    fields: {
      name: { type: "text", maxLength: 200, required: false, searchable: false, sortable: false },
    },
  };
  const listScreen: EntityListScreenDefinition = {
    id: "org-list",
    type: "entityList",
    entity: "org",
    columns: ["name"],
    ...(createScreen !== undefined && { createScreen }),
    ...(createUnavailable && { createUnavailable }),
  };
  const editScreen: EntityEditScreenDefinition = {
    id: "org-edit",
    type: "entityEdit",
    entity: "org",
    layout: { sections: [{ columns: 1, fields: ["name"] }] },
  };
  return {
    featureName: "orgs",
    entities: { org: entity },
    screens: [listScreen, editScreen],
  } as FeatureSchema;
}

async function renderList(
  createScreen: string | undefined,
  createUnavailable = false,
): Promise<{ navigated: NavTarget[]; onCreate: (() => void) | undefined }> {
  const navigated: NavTarget[] = [];
  let onCreate: (() => void) | undefined;
  let tableRendered = false;
  const captureButton: ComponentType<ButtonProps> = (props) => {
    if (props.testId === "render-list-create" || props.testId === "render-list-empty-create") {
      onCreate = props.onClick;
    }
    return null;
  };
  const primitives: CorePrimitives = {
    Button: captureButton,
    Banner: passChildren,
    Field: passChildren,
    Input: noop,
    DataTable: ({ toolbarEnd, emptyState }: DataTableProps) => {
      tableRendered = true;
      return (
        <>
          {toolbarEnd}
          {emptyState}
        </>
      );
    },
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
  render(
    <LocaleProvider resolver={createStaticLocaleResolver({ locale: "de-DE" })}>
      <DispatcherProvider dispatcher={stubDispatcher()}>
        <NavProvider
          value={{
            route: { screenId: "orgs:org-list" },
            navigate: (target) => navigated.push(target),
            replace: () => {},
            hrefFor: () => "",
            searchParams: {},
            setSearchParams: () => {},
          }}
        >
          <PrimitivesProvider value={primitives}>
            <KumikoScreen
              schema={buildSchema(createScreen, createUnavailable)}
              qn="orgs:screen:org-list"
            />
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
  await waitFor(() => expect(tableRendered).toBe(true));
  return { navigated, onCreate };
}

async function clickCreateButton(createScreen: string | undefined): Promise<readonly NavTarget[]> {
  const { navigated, onCreate } = await renderList(createScreen);
  expect(onCreate).toBeDefined();
  onCreate?.();
  return navigated;
}

describe("entityList createScreen", () => {
  test("the create button opens the declared screen instead of the first entityEdit", async () => {
    const navigated = await clickCreateButton("org-wizard");
    expect(navigated.map((target) => ("screenId" in target ? target.screenId : undefined))).toEqual(
      ["org-wizard"],
    );
  });

  test("createUnavailable (create target denied for the role) shows no create button instead of the edit-screen fallback", async () => {
    const { onCreate } = await renderList(undefined, true);
    expect(onCreate).toBeUndefined();
  });

  test("without createScreen the create button opens the entity's edit screen", async () => {
    const navigated = await clickCreateButton(undefined);
    expect(navigated.map((target) => ("screenId" in target ? target.screenId : undefined))).toEqual(
      ["org-edit"],
    );
  });
});
