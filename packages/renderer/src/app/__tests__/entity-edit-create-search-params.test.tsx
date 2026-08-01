// Issue #1680: navigate-params waren bei entityEdit-create nur am
// Papier ("Wird gelesen") dokumentiert — `EntityEditCreateBody` rief
// nie `nav.searchParams` ab, sondern nur `buildInitialValues(entity.
// fields)`. Ein rowAction-navigate mit `params` auf ein entityEdit-
// Ziel öffnete die Maske also leer, ohne Boot-Fehler und ohne
// Warnung. Dieser Test rendert den echten create-Pfad (KumikoScreen →
// EntityEditScreen → EntityEditCreateBody → RenderEdit → RenderField)
// unter einem NavProvider mit gesetzten searchParams und prüft, dass
// der Input tatsächlich vorbelegt ist — nicht nur die extrahierte
// Helper-Funktion isoliert.

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
import { NavProvider } from "../nav";

const captured: Record<string, InputProps> = {};
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

function buildSchema(): FeatureSchema {
  const entity: EntityDefinition = {
    fields: {
      name: { type: "text", maxLength: 200, required: false, searchable: false, sortable: false },
      floorCount: { type: "number", required: false, sortable: false },
    },
  };
  const screen: EntityEditScreenDefinition = {
    id: "unit-edit",
    type: "entityEdit",
    entity: "unit",
    layout: { sections: [{ columns: 1, fields: ["name", "floorCount"] }] },
  };
  return {
    featureName: "housing",
    entities: { unit: entity },
    screens: [screen],
  } as FeatureSchema;
}

describe("EntityEditCreateBody — navigate-params als initial values (#1680)", () => {
  test("URL-searchParams aus rowAction navigate füllen das Create-Form vor", () => {
    captured["name"] = undefined as unknown as InputProps;
    captured["floorCount"] = undefined as unknown as InputProps;
    render(
      <LocaleProvider resolver={createStaticLocaleResolver({ locale: "de-DE" })}>
        <DispatcherProvider dispatcher={stubDispatcher()}>
          <NavProvider
            value={{
              route: { screenId: "housing:unit-edit" },
              navigate: () => {},
              replace: () => {},
              hrefFor: () => "",
              searchParams: { name: "Erdgeschoss", floorCount: "3" },
              setSearchParams: () => {},
            }}
          >
            <PrimitivesProvider value={testPrimitives}>
              <KumikoScreen schema={buildSchema()} qn="housing:screen:unit-edit" />
            </PrimitivesProvider>
          </NavProvider>
        </DispatcherProvider>
      </LocaleProvider>,
    );

    expect(captured["name"]?.value).toBe("Erdgeschoss");
    expect(captured["floorCount"]?.value).toBe(3);
  });

  test("ohne matching searchParam bleibt der Field-Default (leer)", () => {
    captured["name"] = undefined as unknown as InputProps;
    render(
      <LocaleProvider resolver={createStaticLocaleResolver({ locale: "de-DE" })}>
        <DispatcherProvider dispatcher={stubDispatcher()}>
          <NavProvider
            value={{
              route: { screenId: "housing:unit-edit" },
              navigate: () => {},
              replace: () => {},
              hrefFor: () => "",
              searchParams: {},
              setSearchParams: () => {},
            }}
          >
            <PrimitivesProvider value={testPrimitives}>
              <KumikoScreen schema={buildSchema()} qn="housing:screen:unit-edit" />
            </PrimitivesProvider>
          </NavProvider>
        </DispatcherProvider>
      </LocaleProvider>,
    );

    expect(captured["name"]?.value).toBe("");
  });
});
