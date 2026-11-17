import { describe, expect, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import { UserRolesProvider } from "../../context/user-roles-context.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { kumikoDefaultTranslations } from "../../i18n-defaults.ts";
import {
  type BannerProps,
  type ButtonProps,
  type CardProps,
  type FormProps,
  PrimitivesProvider,
} from "../../primitives.tsx";
import { createMockDispatcher, createStubPrimitives } from "../../testing.ts";
import { AppFeaturesProvider } from "../app-features-context.tsx";
import type { FeatureSchema } from "../feature-schema.ts";
import { KumikoScreen } from "../kumiko-screen.tsx";
import type { NavApi } from "../nav.tsx";
import { NavProvider } from "../nav.tsx";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const FormWithActions: ComponentType<FormProps> = ({ children }) => (
  <div data-testid="form-body">{children}</div>
);

const TestBanner: ComponentType<BannerProps> = ({ children, testId, actions }) => (
  <div data-testid={testId}>
    {children}
    {actions}
  </div>
);

const TestButton: ComponentType<ButtonProps> = ({ children, onClick, testId }) => (
  <button type="button" data-testid={testId} onClick={() => void onClick?.()}>
    {children}
  </button>
);

const TestCard: ComponentType<CardProps> = ({ children, testId }) => (
  <div data-testid={testId}>{children}</div>
);

const testPrimitives = createStubPrimitives({
  Button: TestButton,
  Banner: TestBanner,
  Field: passChildren,
  Input: noop,
  DataTable: noop,
  Form: FormWithActions,
  Section: passChildren,
  Card: TestCard,
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
});

function failingThenWorkingDispatcher(): Dispatcher {
  let calls = 0;
  return createMockDispatcher({
    write: async () => ({ isSuccess: true, data: {} }),
    query: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          isSuccess: false,
          error: { code: "unknown", httpStatus: 500, i18nKey: "errors.unknown", message: "boom" },
        };
      }
      return { isSuccess: true, data: { id: "u1", name: "Ada" } };
    },
    batch: async () => ({ isSuccess: true, results: [] }),
  });
}

describe("projectionDetail query errors", () => {
  test("a failed first load shows the error banner with retry instead of the form, retry loads the record", async () => {
    const screenDef = {
      id: "profile",
      type: "projectionDetail",
      query: "app:query:me",
      layout: { sections: [{ title: "s", fields: ["name"] }] },
    } as FeatureSchema["screens"][number];
    const schema: FeatureSchema = { featureName: "app", entities: {}, screens: [screenDef] };
    const navApi: NavApi = {
      route: { screenId: "app:screen:profile" },
      navigate: () => {},
      replace: () => {},
      hrefFor: () => "",
      searchParams: {},
      setSearchParams: () => {},
    };
    const { getByTestId, queryByTestId } = render(
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "de-DE" })}
        fallbackBundles={[kumikoDefaultTranslations]}
      >
        <DispatcherProvider dispatcher={failingThenWorkingDispatcher()}>
          <AppFeaturesProvider features={[schema]}>
            <UserRolesProvider roles={[]}>
              <NavProvider value={navApi}>
                <PrimitivesProvider value={testPrimitives}>
                  <KumikoScreen schema={schema} qn="app:screen:profile" entityId="u1" />
                </PrimitivesProvider>
              </NavProvider>
            </UserRolesProvider>
          </AppFeaturesProvider>
        </DispatcherProvider>
      </LocaleProvider>,
    );

    await waitFor(() => getByTestId("kumiko-screen-retry"));
    expect(queryByTestId("form-body")).toBeNull();

    fireEvent.click(getByTestId("kumiko-screen-retry"));

    await waitFor(() => getByTestId("form-body"));
    expect(queryByTestId("kumiko-screen-error")).toBeNull();
  });
});
