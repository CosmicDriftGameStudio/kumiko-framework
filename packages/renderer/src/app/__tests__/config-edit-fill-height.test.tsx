// configEdit uses the same screen-form layout as entityEdit by default
// (Form fillHeight + stickyActions); `fillHeight: false` opts out.
import { describe, expect, test } from "bun:test";
import type { ConfigEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { render, waitFor } from "@testing-library/react";
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
  const screen: ConfigEditScreenDefinition = {
    id: "settings",
    type: "configEdit",
    scope: "tenant",
    configKeys: { siteName: "demo:config:site-name" },
    fields: {
      siteName: { type: "text", required: false },
      // @cast-boundary inline schema-author shape, FieldDefinition union too narrow
    } as ConfigEditScreenDefinition["fields"],
    layout: { sections: [{ fields: ["siteName"] }] },
    ...(fillHeight !== undefined && { fillHeight }),
  };
  return { featureName: "demo", entities: {}, screens: [screen] };
}

async function captureFormProps(fillHeight?: boolean): Promise<FormProps> {
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
            route: { screenId: "demo:settings" },
            navigate: () => {},
            replace: () => {},
            hrefFor: () => "",
            searchParams: {},
            setSearchParams: () => {},
          }}
        >
          <PrimitivesProvider value={primitives}>
            <KumikoScreen schema={buildSchema(fillHeight)} qn="demo:screen:settings" />
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
  await waitFor(() => expect(captured).toBeDefined());
  if (captured === undefined) throw new Error("Form was not rendered");
  return captured;
}

describe("configEdit fillHeight", () => {
  test("default: form fills the height with a pinned action bar", async () => {
    const props = await captureFormProps();
    expect(props.fillHeight).toBe(true);
    expect(props.stickyActions).toBe(true);
  });

  test("fillHeight: false restores the card layout", async () => {
    const props = await captureFormProps(false);
    expect(props.fillHeight).toBeFalsy();
    expect(props.stickyActions).toBeFalsy();
  });
});
