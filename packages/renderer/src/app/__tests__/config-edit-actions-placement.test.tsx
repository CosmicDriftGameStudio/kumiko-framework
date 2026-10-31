import { describe, expect, test } from "bun:test";
import type { ConfigEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { type CorePrimitives, type FieldProps, PrimitivesProvider } from "../../primitives.tsx";
import { createMockDispatcher } from "../../web/__tests__/test-utils.tsx";
import type { FeatureSchema } from "../feature-schema.ts";
import { KumikoScreen } from "../kumiko-screen.tsx";
import { NavProvider } from "../nav.tsx";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const primitives: CorePrimitives = {
  Button: ({ children }) => <button type="button">{children}</button>,
  Banner: passChildren,
  Field: ({ children, testId }: FieldProps) => <div data-testid={testId}>{children}</div>,
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

describe("configEdit actions", () => {
  test("the action row sits directly after its afterField", async () => {
    const screen: ConfigEditScreenDefinition = {
      id: "settings",
      type: "configEdit",
      scope: "system",
      configKeys: { first: "demo:config:first", second: "demo:config:second" },
      fields: {
        first: { type: "text", required: false },
        second: { type: "text", required: false },
        // @cast-boundary inline schema-author shape, FieldDefinition union too narrow
      } as ConfigEditScreenDefinition["fields"],
      layout: { sections: [{ fields: ["first", "second"] }] },
      actions: [
        {
          id: "probe",
          handler: "demo:write:probe",
          label: "demo.probe.label",
          buttonLabel: "demo.probe.button",
          afterField: "first",
        },
      ],
    };
    const schema: FeatureSchema = { featureName: "demo", entities: {}, screens: [screen] };
    const view = render(
      <LocaleProvider resolver={createStaticLocaleResolver({ locale: "en-US" })}>
        <DispatcherProvider dispatcher={createMockDispatcher()}>
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
              <KumikoScreen schema={schema} qn="demo:screen:settings" />
            </PrimitivesProvider>
          </NavProvider>
        </DispatcherProvider>
      </LocaleProvider>,
    );

    await waitFor(() => expect(view.queryByTestId("config-edit-action-probe")).not.toBeNull());
    const order = [...view.container.querySelectorAll("[data-testid]")].map((el) =>
      el.getAttribute("data-testid"),
    );
    const firstAt = order.indexOf("field-first");
    expect(order.indexOf("config-edit-action-probe")).toBe(firstAt + 1);
    expect(order.indexOf("field-second")).toBeGreaterThan(firstAt + 1);
  });
});
