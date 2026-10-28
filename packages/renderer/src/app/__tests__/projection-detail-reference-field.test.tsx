// projectionDetail fields have no EntityDefinition to carry a real
// "reference" field type (the shim hardcodes every field as "text"), so a
// declared reference field used to render the raw id. This renders the real
// path (KumikoScreen -> ProjectionDetailScreen -> RenderEdit -> RenderField
// -> ReadOnlyReferenceValue) under a stub dispatcher.

import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { render, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import { REFERENCE_COMBOBOX_LIMIT } from "../../hooks/reference-limits.ts";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { kumikoDefaultTranslations } from "../../i18n-defaults.ts";
import { type CorePrimitives, PrimitivesProvider, type TextProps } from "../../primitives.tsx";
import type { FeatureSchema } from "../feature-schema.ts";
import { KumikoScreen } from "../kumiko-screen.tsx";
import type { NavApi } from "../nav.tsx";
import { NavProvider } from "../nav.tsx";

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

// More properties than the reference lookup's first page holds; the session points at the last one.
const propertyRows = Array.from({ length: REFERENCE_COMBOBOX_LIMIT + 10 }, (_, index) => ({
  id: `prop-${index + 1}`,
  name: `Property ${index + 1}`,
}));
const lastPropertyId = propertyRows[propertyRows.length - 1]?.id;

// Mirrors the entity list handler: an `id in` filter narrows, `limit` caps the page.
function answerPropertyList(payload: unknown): Record<string, unknown> {
  const { limit, filters } = payload as {
    readonly limit: number;
    readonly filters?: readonly { field: string; op: string; value: readonly string[] }[];
  };
  const idFilter = filters?.find((filter) => filter.field === "id" && filter.op === "in");
  const matching =
    idFilter === undefined
      ? propertyRows
      : propertyRows.filter((row) => idFilter.value.includes(row.id));
  const page = matching.slice(0, limit);
  return { rows: page, nextCursor: matching.length > limit ? "next" : null };
}

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
    query: (async (type: string, payload: unknown) => {
      if (type === "sessions:query:session:detail") {
        return {
          isSuccess: true,
          data: {
            id: "sess-1",
            userId: "u-1",
            actedBy: SYSTEM_USER_ID,
            ip: "10.0.0.1",
            propertyId: lastPropertyId,
          },
        };
      }
      if (type === "property:query:property:list") {
        return { isSuccess: true, data: answerPropertyList(payload) };
      }
      // user:user resolves through the tenant-scoped member directory, not the
      // SystemAdmin-only user:query:user:list a TenantAdmin can't call.
      if (type === "tenant:query:member-directory") {
        return {
          isSuccess: true,
          data: { rows: [{ id: "u-1", label: "Jane Doe" }], nextCursor: null },
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
        fields: [
          { field: "userId", refEntity: "user:user", refLabelField: "displayName" },
          // Mirrors the audit-log detail actor field — a system
          // write has no read_users row for the bulk lookup to find.
          { field: "actedBy", refEntity: "user:user", refLabelField: "displayName" },
          "ip",
          { field: "propertyId", refEntity: "property:property", refLabelField: "name" },
        ],
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

describe("projectionDetail reference field resolves labels", () => {
  test("a field with refEntity metadata shows the resolved display name instead of the raw id", async () => {
    const { getByTestId } = renderDetailScreen();

    await waitFor(() => {
      expect(getByTestId("field-value-userId").textContent).toBe("Jane Doe");
    });
  });

  test("SYSTEM_USER_ID resolves to the system label instead of the raw id", async () => {
    const { getByTestId } = renderDetailScreen();

    await waitFor(() => {
      expect(getByTestId("field-value-actedBy").textContent).toBe("System");
    });
  });

  test("a referenced row beyond the lookup's first page still shows its label", async () => {
    const { getByTestId } = renderDetailScreen();

    await waitFor(() => {
      expect(getByTestId("field-value-propertyId").textContent).toBe(
        `Property ${REFERENCE_COMBOBOX_LIMIT + 10}`,
      );
    });
  });

  test("non-regression: a field without refEntity metadata renders its raw value unchanged", async () => {
    const { getByTestId } = renderDetailScreen();

    await waitFor(() => {
      expect(getByTestId("field-value-ip").textContent).toBe("10.0.0.1");
    });
  });
});
