// Issue #1680: navigate params on entityEdit-create were documented as
// "will be read" but EntityEditCreateBody never consulted nav.searchParams —
// only buildInitialValues(entity.fields). A rowAction navigate with params
// to an entityEdit target therefore opened an empty form with no boot error.
// This test renders the real create path (KumikoScreen → EntityEditScreen →
// EntityEditCreateBody → RenderEdit → RenderField) under a NavProvider with
// searchParams set and asserts the input is prefilled — not just the helper
// in isolation.
import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { type CorePrimitives, type InputProps, PrimitivesProvider } from "../../primitives";
import type { FeatureSchema } from "../feature-schema";
import { KumikoScreen } from "../kumiko-screen";
import { type NavApi, NavProvider } from "../nav";

const captured: Record<string, InputProps | undefined> = {};
const captureInput: ComponentType<InputProps> = (props) => {
  captured[props.name] = props;
  return null;
};
const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const testPrimitives: CorePrimitives = {
  Button: noop,
  Banner: passChildren,
  Field: passChildren,
  Input: captureInput,
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
    query: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["query"],
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

function buildSchema(urlPrefillFields: readonly string[] | undefined): FeatureSchema {
  const entity: EntityDefinition = {
    fields: {
      name: { type: "text", maxLength: 200, required: false, searchable: false, sortable: false },
      floorCount: { type: "number", required: false, sortable: false },
      ownerEmail: { type: "text", maxLength: 200, required: false, searchable: false },
      accessCode: {
        type: "text",
        maxLength: 200,
        required: false,
        searchable: false,
        sensitive: true,
      },
    },
  };
  const screen: EntityEditScreenDefinition = {
    id: "unit-edit",
    type: "entityEdit",
    entity: "unit",
    layout: {
      sections: [{ columns: 1, fields: ["name", "floorCount", "ownerEmail", "accessCode"] }],
    },
    ...(urlPrefillFields !== undefined && { urlPrefillFields }),
  };
  return {
    featureName: "housing",
    entities: { unit: entity },
    screens: [screen],
  } as FeatureSchema;
}

function staticNav(searchParams: Record<string, string>): NavApi {
  return {
    route: { screenId: "housing:unit-edit" },
    navigate: () => {},
    replace: () => {},
    hrefFor: () => "",
    searchParams,
    setSearchParams: () => {},
  };
}

function renderWithNav(nav: NavApi, schema: FeatureSchema): void {
  render(
    <LocaleProvider resolver={createStaticLocaleResolver({ locale: "de-DE" })}>
      <DispatcherProvider dispatcher={stubDispatcher()}>
        <NavProvider value={nav}>
          <PrimitivesProvider value={testPrimitives}>
            <KumikoScreen schema={schema} qn="housing:screen:unit-edit" />
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

function resetCaptured(): void {
  for (const key of Object.keys(captured)) delete captured[key];
}

describe("EntityEditCreateBody — navigate params as initial values (#1680)", () => {
  test("URL searchParams from rowAction navigate prefill the create form", () => {
    resetCaptured();
    renderWithNav(
      staticNav({ name: "Erdgeschoss", floorCount: "3" }),
      buildSchema(["name", "floorCount"]),
    );

    expect(captured["name"]?.value).toBe("Erdgeschoss");
    expect(captured["floorCount"]?.value).toBe(3);
  });

  test("without a matching searchParam the field keeps its default (empty)", () => {
    resetCaptured();
    renderWithNav(staticNav({}), buildSchema(["name"]));

    expect(captured["name"]?.value).toBe("");
  });

  test("a crafted link cannot prefill a field outside urlPrefillFields", () => {
    resetCaptured();
    renderWithNav(
      staticNav({ name: "Erdgeschoss", ownerEmail: "attacker@example.com" }),
      buildSchema(["name"]),
    );

    expect(captured["name"]?.value).toBe("Erdgeschoss");
    expect(captured["ownerEmail"]?.value).toBe("");
  });

  test("a screen without urlPrefillFields takes nothing from the URL", () => {
    resetCaptured();
    renderWithNav(staticNav({ name: "Erdgeschoss" }), buildSchema(undefined));

    expect(captured["name"]?.value).toBe("");
  });

  test("a sensitive field stays empty even when urlPrefillFields names it", () => {
    resetCaptured();
    renderWithNav(staticNav({ accessCode: "1234" }), buildSchema(["accessCode"]));

    expect(captured["accessCode"]?.value).toBe("");
  });
});
