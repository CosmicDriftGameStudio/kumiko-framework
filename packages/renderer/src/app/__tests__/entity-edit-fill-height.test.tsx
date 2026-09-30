// fw#3381: an entityEdit screen pins its action bar to the shell height by
// default (Form fillHeight + stickyActions); `fillHeight: false` opts out.
import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.js";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.js";
import { type CorePrimitives, type FormProps, PrimitivesProvider } from "../../primitives.js";
import type { FeatureSchema } from "../feature-schema.js";
import { KumikoScreen } from "../kumiko-screen.js";
import { NavProvider } from "../nav.js";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

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

function buildSchema(fillHeight?: boolean): FeatureSchema {
  const entity: EntityDefinition = {
    fields: {
      name: { type: "text", maxLength: 200, required: false, searchable: false, sortable: false },
    },
  };
  const screen: EntityEditScreenDefinition = {
    id: "unit-edit",
    type: "entityEdit",
    entity: "unit",
    layout: { sections: [{ columns: 1, fields: ["name"] }] },
    ...(fillHeight !== undefined && { fillHeight }),
  };
  return {
    featureName: "housing",
    entities: { unit: entity },
    screens: [screen],
  } as FeatureSchema;
}

function captureFormProps(fillHeight?: boolean): FormProps {
  let captured: FormProps | undefined;
  const capturingForm: ComponentType<FormProps> = (props) => {
    captured = props;
    return null;
  };
  const primitives: CorePrimitives = {
    Button: noop,
    Banner: passChildren,
    Field: passChildren,
    Input: noop,
    DataTable: noop,
    Form: capturingForm,
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
            route: { screenId: "housing:unit-edit" },
            navigate: () => {},
            replace: () => {},
            hrefFor: () => "",
            searchParams: {},
            setSearchParams: () => {},
          }}
        >
          <PrimitivesProvider value={primitives}>
            <KumikoScreen schema={buildSchema(fillHeight)} qn="housing:screen:unit-edit" />
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
  if (captured === undefined) throw new Error("Form was not rendered");
  return captured;
}

describe("entityEdit fillHeight (fw#3381)", () => {
  test("default: form fills the height with a pinned action bar", () => {
    const props = captureFormProps();
    expect(props.fillHeight).toBe(true);
    expect(props.stickyActions).toBe(true);
  });

  test("fillHeight: false restores page scroll", () => {
    const props = captureFormProps(false);
    expect(props.fillHeight).toBeFalsy();
    expect(props.stickyActions).toBeFalsy();
  });
});
