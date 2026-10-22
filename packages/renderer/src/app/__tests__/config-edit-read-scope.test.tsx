import { describe, expect, mock, test } from "bun:test";
import type { ConfigEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { type CorePrimitives, PrimitivesProvider } from "../../primitives.tsx";
import { createMockDispatcher } from "../../web/__tests__/test-utils.tsx";
import type { FeatureSchema } from "../feature-schema.ts";
import { KumikoScreen } from "../kumiko-screen.tsx";
import { NavProvider } from "../nav.tsx";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const primitives: CorePrimitives = {
  Button: noop,
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

describe("configEdit reads at the scope it edits", () => {
  test("a system-scope screen asks config:query:values for the system level", async () => {
    const query = mock(async (_name: string, _payload: unknown) => ({ isSuccess: true, data: {} }));
    const screen: ConfigEditScreenDefinition = {
      id: "settings",
      type: "configEdit",
      scope: "system",
      configKeys: { siteName: "demo:config:site-name" },
      fields: {
        siteName: { type: "text", required: false },
        // @cast-boundary inline schema-author shape, FieldDefinition union too narrow
      } as ConfigEditScreenDefinition["fields"],
      layout: { sections: [{ fields: ["siteName"] }] },
    };
    const schema: FeatureSchema = { featureName: "demo", entities: {}, screens: [screen] };
    render(
      <LocaleProvider resolver={createStaticLocaleResolver({ locale: "de-DE" })}>
        <DispatcherProvider
          dispatcher={createMockDispatcher({
            // @cast-boundary test-stub: the recorded query ignores the typed handler registry
            query: query as unknown as Dispatcher["query"],
          })}
        >
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

    await waitFor(() =>
      expect(query.mock.calls.map(([name, payload]) => ({ name, payload }))).toContainEqual({
        name: "config:query:values",
        payload: { scope: "system" },
      }),
    );
  });
});
