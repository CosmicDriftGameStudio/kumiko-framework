// fw#2312: `singleton: true` marks a projectionDetail screen whose query
// determines the shown row from the caller's session/context instead of a
// row id in the path (a self-service "my profile"/"my data" screen has no
// row to link to). Before this flag, ProjectionDetailBody always rendered
// the "needs a row id in the path" error banner when `entityId` was
// undefined (kumiko-screen.tsx) — both user-profile and user-data-rights'
// privacy-center screen hit exactly that, unrenderable, until the flag
// existed (fw#2312 bug report). This proves the fix, the no-flag regression
// case stays covered, and that a stray/spoofed path id never reaches the
// query under singleton (renderer-side half of the security requirement —
// the boot-validator half lives in framework's projection-detail-
// singleton.test.ts).

import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { render, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { UserRolesProvider } from "../../context/user-roles-context";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import {
  type BannerProps,
  type CorePrimitives,
  type FormProps,
  PrimitivesProvider,
} from "../../primitives";
import { AppFeaturesProvider } from "../app-features-context";
import type { FeatureSchema } from "../feature-schema";
import { KumikoScreen } from "../kumiko-screen";
import type { NavApi } from "../nav";
import { NavProvider } from "../nav";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const FormWithActions: ComponentType<FormProps> = ({ children }) => (
  <div data-testid="form-body">{children}</div>
);

const TestBanner: ComponentType<BannerProps> = ({ children, testId }) => (
  <div data-testid={testId}>{children}</div>
);

const testPrimitives: CorePrimitives = {
  Button: noop,
  Banner: TestBanner,
  Field: passChildren,
  Input: noop,
  DataTable: noop,
  Form: FormWithActions,
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

function stubDispatcher(
  record: Readonly<Record<string, unknown>> | null,
  queries: Array<{ type: string; payload: unknown }>,
): Dispatcher {
  return {
    write: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"],
    query: (async (type: string, payload: unknown) => {
      queries.push({ type, payload });
      return { isSuccess: true, data: record };
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

function meScreen(
  overrides?: Partial<ProjectionDetailScreenDefinition>,
): FeatureSchema["screens"][number] {
  return {
    id: "profile",
    type: "projectionDetail",
    query: "app:query:me",
    layout: { sections: [{ title: "s", fields: ["name"] }] },
    ...overrides,
  } as FeatureSchema["screens"][number];
}

function renderScreen(opts: {
  readonly screen: FeatureSchema["screens"][number];
  readonly entityId?: string;
  readonly queries: Array<{ type: string; payload: unknown }>;
  readonly record?: Readonly<Record<string, unknown>> | null;
}): ReturnType<typeof render> {
  const schema: FeatureSchema = { featureName: "app", entities: {}, screens: [opts.screen] };
  const navApi: NavApi = {
    route: { screenId: "app:screen:profile" },
    navigate: () => {},
    replace: () => {},
    hrefFor: () => "",
    searchParams: {},
    setSearchParams: () => {},
  };
  return render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "de-DE" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider
        dispatcher={stubDispatcher(
          opts.record !== undefined ? opts.record : { id: "u1", name: "Ada" },
          opts.queries,
        )}
      >
        <AppFeaturesProvider features={[schema]}>
          <UserRolesProvider roles={[]}>
            <NavProvider value={navApi}>
              <PrimitivesProvider value={testPrimitives}>
                <KumikoScreen
                  schema={schema}
                  qn="app:screen:profile"
                  {...(opts.entityId !== undefined && { entityId: opts.entityId })}
                />
              </PrimitivesProvider>
            </NavProvider>
          </UserRolesProvider>
        </AppFeaturesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

describe("projectionDetail singleton (fw#2312)", () => {
  test("singleton + no path id renders the record instead of the missing-id banner", async () => {
    const queries: Array<{ type: string; payload: unknown }> = [];
    const { queryByTestId, getByTestId } = renderScreen({
      screen: meScreen({ singleton: true }),
      queries,
    });

    await waitFor(() => expect(getByTestId("form-body")).toBeTruthy());
    expect(queryByTestId("kumiko-screen-projection-detail-missing-id")).toBeNull();
    expect(queries).toEqual([{ type: "app:query:me", payload: {} }]);
  });

  test("no singleton flag + no path id still shows the missing-id banner (no regression)", async () => {
    const queries: Array<{ type: string; payload: unknown }> = [];
    const { getByTestId } = renderScreen({ screen: meScreen(), queries });

    await waitFor(() =>
      expect(getByTestId("kumiko-screen-projection-detail-missing-id")).toBeTruthy(),
    );
  });

  test("singleton ignores a stray path id — the query never receives it", async () => {
    const queries: Array<{ type: string; payload: unknown }> = [];
    const { getByTestId } = renderScreen({
      screen: meScreen({ singleton: true }),
      entityId: "attacker-controlled-id",
      queries,
    });

    await waitFor(() => expect(getByTestId("form-body")).toBeTruthy());
    expect(queries).toEqual([{ type: "app:query:me", payload: {} }]);
  });

  test("singleton + record-not-found banner never shows the (ignored) path id", async () => {
    const queries: Array<{ type: string; payload: unknown }> = [];
    const { getByTestId } = renderScreen({
      screen: meScreen({ singleton: true }),
      entityId: "99",
      record: null,
      queries,
    });

    const banner = await waitFor(() => getByTestId("kumiko-screen-record-missing"));
    expect(banner.textContent).toBe("Record not found.");
    expect(banner.textContent).not.toContain("99");
  });
});
