// fw#2662: projectionDetail fields have no EntityDefinition to carry a real
// "reference" field type (the shim hardcodes every field as "text"), so a
// declared reference field used to render the raw id. This renders the real
// path (KumikoScreen -> ProjectionDetailScreen -> RenderEdit -> RenderField
// -> ReadOnlyReferenceValue) under a stub dispatcher.

import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { render, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import { type CorePrimitives, PrimitivesProvider, type TextProps } from "../../primitives";
import type { FeatureSchema } from "../feature-schema";
import { KumikoScreen } from "../kumiko-screen";
import type { NavApi } from "../nav";
import { NavProvider } from "../nav";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;
// passChildren would drop testId — ReadOnlyReferenceValue/readOnlyDisplayText
// render their resolved text into `<Text testId="field-value-<field>">`, and
// the assertions below read it back by that testid.
const TestText: ComponentType<TextProps> = ({ children, testId }) => (
  <span data-testid={testId}>{children}</span>
);

const testPrimitives: CorePrimitives = {
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
  Text: TestText,
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
    query: (async (type: string) => {
      if (type === "sessions:query:session:detail") {
        return {
          isSuccess: true,
          data: { id: "sess-1", userId: "u-1", ip: "10.0.0.1" },
        };
      }
      if (type === "user:query:user:list") {
        return {
          isSuccess: true,
          data: { rows: [{ id: "u-1", displayName: "Jane Doe" }], nextCursor: null },
        };
      }
      return { isSuccess: true, data: { rows: [], nextCursor: null } };
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

const detailScreen: ProjectionDetailScreenDefinition = {
  id: "session-detail",
  type: "projectionDetail",
  query: "sessions:query:session:detail",
  layout: {
    sections: [
      {
        fields: [{ field: "userId", refEntity: "user:user", refLabelField: "displayName" }, "ip"],
      },
    ],
  },
};

function buildSchema(): FeatureSchema {
  return {
    featureName: "sessions",
    entities: {},
    screens: [detailScreen],
  } as FeatureSchema;
}

const staticNav: NavApi = {
  route: { screenId: "sessions:screen:session-detail" },
  navigate: () => {},
  replace: () => {},
  hrefFor: () => "",
  searchParams: {},
  setSearchParams: () => {},
};

function renderDetailScreen(): ReturnType<typeof render> {
  return render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={stubDispatcher()}>
        <NavProvider value={staticNav}>
          <PrimitivesProvider value={testPrimitives}>
            <KumikoScreen
              schema={buildSchema()}
              qn="sessions:screen:session-detail"
              entityId="sess-1"
            />
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

describe("projectionDetail reference field resolves labels (fw#2662)", () => {
  test("a field with refEntity metadata shows the resolved display name instead of the raw id", async () => {
    const { getByTestId } = renderDetailScreen();

    await waitFor(() => {
      expect(getByTestId("field-value-userId").textContent).toBe("Jane Doe");
    });
  });

  test("non-regression: a field without refEntity metadata renders its raw value unchanged", async () => {
    const { getByTestId } = renderDetailScreen();

    await waitFor(() => {
      expect(getByTestId("field-value-ip").textContent).toBe("10.0.0.1");
    });
  });
});
