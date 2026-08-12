// Guard-evasion-adjacent bug: useNavigateToCreateFor picked the first
// entityEdit screen with allowCreate !== false as the "+ Neu" target,
// without excluding singleton:true screens. A singleton screen opened
// without an entityId resolves the existing record (EntityEditSingletonBody)
// instead of a blank create form — so "+ Neu" silently opened a prefilled
// update form. This test renders the real list path (KumikoScreen →
// EntityListScreen → EntityListBody → RenderList) for an entity whose only
// registered entityEdit screen is a singleton, and asserts no create button
// renders — not just the hook in isolation.
import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { type ButtonProps, type CorePrimitives, PrimitivesProvider } from "../../primitives";
import type { FeatureSchema } from "../feature-schema";
import { KumikoScreen } from "../kumiko-screen";
import { NavProvider } from "../nav";

const capturedButtonTestIds: string[] = [];
const captureButton: ComponentType<ButtonProps> = (props) => {
  if (props.testId !== undefined) capturedButtonTestIds.push(props.testId);
  return null;
};
const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const testPrimitives: CorePrimitives = {
  Button: captureButton,
  Banner: passChildren,
  Field: passChildren,
  Input: noop,
  DataTable: noop,
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

function buildSchema(): FeatureSchema {
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
  };
  // The only entityEdit screen for "org" is a singleton — there is
  // deliberately no separate non-singleton entityEdit screen.
  const editScreen: EntityEditScreenDefinition = {
    id: "org-edit",
    type: "entityEdit",
    entity: "org",
    singleton: true,
    layout: { sections: [{ columns: 1, fields: ["name"] }] },
  };
  return {
    featureName: "orgs",
    entities: { org: entity },
    screens: [listScreen, editScreen],
  } as FeatureSchema;
}

describe("entityList '+ Neu' target excludes singleton entityEdit screens", () => {
  test("no create button renders when the only entityEdit screen is singleton:true", () => {
    capturedButtonTestIds.length = 0;
    render(
      <LocaleProvider resolver={createStaticLocaleResolver({ locale: "de-DE" })}>
        <DispatcherProvider dispatcher={stubDispatcher()}>
          <NavProvider
            value={{
              route: { screenId: "orgs:org-list" },
              navigate: () => {},
              replace: () => {},
              hrefFor: () => "",
              searchParams: {},
              setSearchParams: () => {},
            }}
          >
            <PrimitivesProvider value={testPrimitives}>
              <KumikoScreen schema={buildSchema()} qn="orgs:screen:org-list" />
            </PrimitivesProvider>
          </NavProvider>
        </DispatcherProvider>
      </LocaleProvider>,
    );

    expect(capturedButtonTestIds).not.toContain("render-list-create");
    expect(capturedButtonTestIds).not.toContain("render-list-empty-create");
  });
});
