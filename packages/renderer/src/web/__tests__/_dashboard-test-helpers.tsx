import type { DashboardScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import type { QueryResult } from "../../headless/index.ts";
import { isRecord } from "../../headless/is-record.ts";
import type { FeatureSchema } from "../../index.ts";
import {
  AppFeaturesProvider,
  createStaticLocaleResolver,
  DashboardBodyProvider,
  DispatcherProvider,
  type ExtensionSectionProps,
  ExtensionSectionsProvider,
  KumikoScreen,
  kumikoDefaultTranslations,
  LocaleProvider,
  NavProvider,
  type TranslationsByLocale,
} from "../../index.ts";
import { WebDashboardBody } from "../app/dashboard-body.tsx";
import { useBrowserNavApi } from "../app/nav.tsx";
import { PageHeaderSlotProvider } from "../layout/page-header-slot.tsx";
import { ShellHeader } from "../layout/shell-header.tsx";
import { createMockDispatcher, render, renderWithSidebar } from "./test-utils.tsx";

export type Handler = (
  payload: Readonly<Record<string, unknown>>,
) => QueryResult | Promise<QueryResult>;

export const FEATURE = "demo";

function BrowserNav({
  children,
  features,
}: {
  readonly children: ReactNode;
  readonly features?: readonly FeatureSchema[] | undefined;
}): ReactNode {
  const nav = useBrowserNavApi({ hasWorkspaces: false, ...(features && { features }) });
  return <NavProvider value={nav}>{children}</NavProvider>;
}

export function renderDashboard(
  dashboard: DashboardScreenDefinition,
  handlers: Readonly<Record<string, Handler>>,
  options: {
    readonly locale?: string;
    readonly appFeatures?: readonly FeatureSchema[];
    /** Renders below the app shell page-header slot like the real app. */
    readonly shell?: boolean;
    readonly translations?: TranslationsByLocale;
    readonly extensionSections?: Readonly<
      Record<string, (props: ExtensionSectionProps) => ReactNode>
    >;
  } = {},
): { readonly calls: { readonly type: string; readonly payload: Record<string, unknown> }[] } {
  const calls: { readonly type: string; readonly payload: Record<string, unknown> }[] = [];
  const dispatcher = createMockDispatcher({
    query: async (type: string, rawPayload: unknown) => {
      const payload = isRecord(rawPayload) ? rawPayload : {};
      calls.push({ type, payload });
      const handler = handlers[type];
      if (handler === undefined) return { isSuccess: true, data: {} };
      const result = await handler(payload);
      return result;
    },
  });
  const schema: FeatureSchema = { featureName: FEATURE, entities: {}, screens: [dashboard] };
  const screenNode = (
    <AppFeaturesProvider features={options.appFeatures ?? []}>
      <BrowserNav features={options.appFeatures}>
        <DispatcherProvider dispatcher={dispatcher}>
          <ExtensionSectionsProvider value={options.extensionSections ?? {}}>
            <DashboardBodyProvider value={WebDashboardBody}>
              {options.shell === true ? (
                <PageHeaderSlotProvider>
                  <ShellHeader schema={{ features: [schema] }} />
                  <KumikoScreen schema={schema} qn={`${FEATURE}:screen:${dashboard.id}`} />
                </PageHeaderSlotProvider>
              ) : (
                <KumikoScreen schema={schema} qn={`${FEATURE}:screen:${dashboard.id}`} />
              )}
            </DashboardBodyProvider>
          </ExtensionSectionsProvider>
        </DispatcherProvider>
      </BrowserNav>
    </AppFeaturesProvider>
  );
  const mount = options.shell === true ? renderWithSidebar : render;
  mount(
    options.locale === undefined ? (
      screenNode
    ) : (
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: options.locale })}
        fallbackBundles={[
          ...(options.translations !== undefined ? [options.translations] : []),
          kumikoDefaultTranslations,
        ]}
      >
        {screenNode}
      </LocaleProvider>
    ),
  );
  return { calls };
}

export const ok = (data: unknown): QueryResult => ({ isSuccess: true, data });
export const failure: QueryResult = {
  isSuccess: false,
  error: {
    code: "internal",
    httpStatus: 500,
    message: "kaputt",
    i18nKey: "errors.internal",
  },
};

export const DAY = 86_400_000;
export const day1 = Date.UTC(2026, 0, 1);
export const day2 = day1 + DAY;
export const day3 = day2 + DAY;
export const windowEndMs = day3 + 12 * 3_600_000;

export const dayPoints = (values: readonly number[]) =>
  values.map((value, i) => ({ atMs: day1 + i * DAY, value }));

export function chartScreen(
  chart: "timeseries" | "stacked-bars" | "segment-bars" | "stacked-area",
  extra: Record<string, unknown> = {},
): DashboardScreenDefinition {
  return {
    id: "charts",
    type: "dashboard",
    panels: [
      {
        kind: "chart",
        id: "main",
        label: "demo:chart",
        chart,
        query: "demo:query:metric:chart",
        ...extra,
      },
    ],
  } as DashboardScreenDefinition;
}
