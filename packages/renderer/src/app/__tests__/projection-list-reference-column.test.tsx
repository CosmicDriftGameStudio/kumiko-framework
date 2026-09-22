// fw#2662: projectionList columns have no EntityDefinition to carry a real
// "reference" field type (the shim hardcodes every field as "text"), so a
// declared reference column used to render the raw GUID. This renders the
// real path (KumikoScreen -> ProjectionListScreen -> RenderList ->
// useReferenceLookup) under a stub dispatcher, and reads the resolved cell
// text back off the reference column's injected runtime renderer.

import { describe, expect, test } from "bun:test";
import type {
  ListColumnSpec,
  ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher, RuntimeRenderer } from "@cosmicdrift/kumiko-headless";
import { render, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import { type CorePrimitives, type DataTableProps, PrimitivesProvider } from "../../primitives";
import type { FeatureSchema } from "../feature-schema";
import { KumikoScreen } from "../kumiko-screen";
import type { NavApi } from "../nav";
import { NavProvider } from "../nav";

const SYSTEM_TENANT_ID = "00000000-0000-4000-8000-000000000000";
const REAL_TENANT_ID = "11111111-1111-4111-8111-111111111111";
const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
const REAL_USER_ID = "22222222-2222-4222-8222-222222222222";
const DELETED_USER_ID = "33333333-3333-4333-8333-333333333333";

let capturedProps: DataTableProps | undefined;
const captureDataTable: ComponentType<DataTableProps> = (props) => {
  capturedProps = props;
  return null;
};
const getCapturedProps = (): DataTableProps | undefined => capturedProps;
const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const testPrimitives: CorePrimitives = {
  Button: noop,
  Banner: passChildren,
  Field: passChildren,
  Input: noop,
  DataTable: captureDataTable,
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
    query: (async (type: string) => {
      if (type === "delivery:query:log:list") {
        return {
          isSuccess: true,
          data: {
            rows: [
              { id: "row-1", tenantId: REAL_TENANT_ID, createdBy: REAL_USER_ID },
              { id: "row-2", tenantId: SYSTEM_TENANT_ID, createdBy: SYSTEM_USER_ID },
              { id: "row-3", tenantId: REAL_TENANT_ID, createdBy: DELETED_USER_ID },
            ],
            nextCursor: null,
          },
        };
      }
      // tenant:tenant resolves through the tenant directory, not the
      // SystemAdmin-only tenant:query:tenant:list a TenantAdmin can't call
      // (fw#3142).
      if (type === "tenant:query:tenant-directory") {
        return {
          isSuccess: true,
          data: { rows: [{ id: REAL_TENANT_ID, label: "Acme Inc" }], nextCursor: null },
        };
      }
      // user:user resolves through the tenant-scoped member directory, not the
      // SystemAdmin-only user:query:user:list a TenantAdmin can't call (fw#3107).
      if (type === "tenant:query:member-directory") {
        return {
          isSuccess: true,
          data: { rows: [{ id: REAL_USER_ID, label: "Ada Lovelace" }], nextCursor: null },
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

function buildSchema(screen: ProjectionListScreenDefinition): FeatureSchema {
  return {
    featureName: "delivery",
    entities: {},
    screens: [screen],
  } as FeatureSchema;
}

const TENANT_COLUMN: ListColumnSpec = {
  field: "tenantId",
  label: "delivery.log.col.tenantId",
  refEntity: "tenant:tenant",
  refLabelField: "name",
};

// Mirrors the audit-log actor column (fw#3103).
const ACTOR_COLUMN: ListColumnSpec = {
  field: "createdBy",
  label: "audit.log.col.actor",
  refEntity: "user:user",
  refLabelField: "displayName",
};

const staticNav: NavApi = {
  route: { screenId: "delivery:screen:log" },
  navigate: () => {},
  replace: () => {},
  hrefFor: () => "",
  searchParams: {},
  setSearchParams: () => {},
};

function renderLogScreen(column: ListColumnSpec = TENANT_COLUMN): void {
  const screen: ProjectionListScreenDefinition = {
    id: "log",
    type: "projectionList",
    query: "delivery:query:log:list",
    columns: [column],
  };
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={stubDispatcher()}>
        <NavProvider value={staticNav}>
          <PrimitivesProvider value={testPrimitives}>
            <KumikoScreen schema={buildSchema(screen)} qn="delivery:screen:log" />
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

function referenceRenderer(field = "tenantId"): RuntimeRenderer {
  const col = getCapturedProps()?.columns.find((c) => c.field === field);
  if (typeof col?.renderer !== "function") throw new Error("reference column has no renderer yet");
  return col.renderer as RuntimeRenderer;
}

describe("projectionList reference column resolves labels (fw#2662)", () => {
  test("a real tenant id resolves to its name instead of the raw GUID", async () => {
    capturedProps = undefined;
    renderLogScreen();

    await waitFor(() => {
      expect(referenceRenderer()(REAL_TENANT_ID, { tenantId: REAL_TENANT_ID })).toBe("Acme Inc");
    });
  });

  test("SYSTEM_TENANT_ID resolves to the system label instead of the raw GUID", async () => {
    capturedProps = undefined;
    renderLogScreen();

    await waitFor(() => {
      expect(referenceRenderer()(SYSTEM_TENANT_ID, { tenantId: SYSTEM_TENANT_ID })).toBe("System");
    });
  });
});

describe("actor column resolves display names (fw#3103)", () => {
  const actorCell = (id: string): unknown => referenceRenderer("createdBy")(id, { createdBy: id });

  test("a real user id resolves to the display name", async () => {
    capturedProps = undefined;
    renderLogScreen(ACTOR_COLUMN);

    await waitFor(() => {
      expect(actorCell(REAL_USER_ID)).toBe("Ada Lovelace");
    });
  });

  test("SYSTEM_USER_ID resolves to the system label", async () => {
    capturedProps = undefined;
    renderLogScreen(ACTOR_COLUMN);

    await waitFor(() => {
      expect(actorCell(SYSTEM_USER_ID)).toBe("System");
    });
  });

  test("an unresolvable actor (deleted user) falls back to the raw id without throwing", async () => {
    capturedProps = undefined;
    renderLogScreen(ACTOR_COLUMN);

    await waitFor(() => {
      expect(actorCell(REAL_USER_ID)).toBe("Ada Lovelace");
    });
    expect(actorCell(DELETED_USER_ID)).toBe(DELETED_USER_ID);
  });
});
