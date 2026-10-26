import type {
  DashboardCurrencyFormat,
  DashboardPanelEmptyState,
  DashboardPanelQueryOptions,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { currencyDecimals, type Translate } from "../../headless/index.ts";
import {
  dispatcherErrorText,
  type UseQueryResult,
  useLocale,
  usePrimitives,
  useQuery,
  useTranslation,
} from "../../index.ts";
import { resolveSafeLocale } from "../primitives/locale-number.ts";
import { formatMoney } from "../primitives/money-input.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { EmptyState, LoadingState } from "../widgets/states.tsx";
import { useRelativeTimeFormatter } from "./relative-time.ts";

const SKELETON_SEGMENT_WIDTHS = ["100%", "72%", "48%"] as const;

export const WIDE_PANEL = "sm:col-span-2 lg:col-span-4";

export const HALF_PANEL = "sm:col-span-2 lg:col-span-2";

const CURRENCY_CODE_PATTERN = /^[A-Za-z]{3}$/;

export const HOUR_MS = 3_600_000;

export const DAY_MS = 24 * HOUR_MS;

const SKELETON_BAR_HEIGHTS = ["40%", "65%", "50%", "85%", "60%", "75%", "45%", "70%"];

export type ScreenParams = {
  readonly filterParams: Readonly<Record<string, unknown>>;
  readonly rangeParams: Readonly<Record<string, unknown>>;
  /** `{ [payloadKey]: recordId }` of a record-bound dashboard, else empty. */
  readonly recordParams: Readonly<Record<string, unknown>>;
  /** Id read from `record.param`; set whenever the dashboard renders its panels. */
  readonly recordId?: string;
};

export function panelPayload(
  panel: DashboardPanelQueryOptions,
  screenParams: ScreenParams,
): Readonly<Record<string, unknown>> {
  return {
    ...(panel.ignoreScreenFilter === true ? {} : screenParams.filterParams),
    ...screenParams.rangeParams,
    ...screenParams.recordParams,
    ...panel.params,
  };
}

type RefetchQuery = () => Promise<void>;

type DashboardQueryRuntime = {
  /** Polling interval for every panel and gate query; undefined = off. */
  readonly refreshIntervalMs: number | undefined;
  /** Adds a query's refetch to the set `refetchAll` walks; returns its removal. */
  readonly register: (refetch: RefetchQuery) => () => void;
};

export const DashboardQueryContext = createContext<DashboardQueryRuntime>({
  refreshIntervalMs: undefined,
  register: () => () => {},
});

export function useRefetchRegistry(): {
  readonly register: DashboardQueryRuntime["register"];
  readonly refetchRegistered: () => Promise<void>;
} {
  const registered = useRef(new Set<RefetchQuery>());
  const register = useCallback((refetch: RefetchQuery) => {
    registered.current.add(refetch);
    return () => {
      registered.current.delete(refetch);
    };
  }, []);
  const refetchRegistered = useCallback(async () => {
    await Promise.all([...registered.current].map((refetch) => refetch()));
  }, []);
  return { register, refetchRegistered };
}

/** Live query of a panel or gate that takes part in the dashboard's refresh:
 *  polls at the screen's interval and is refetched by `refetchAll` after an
 *  action. A disabled query registers nothing. */
export function useDashboardQuery<TData>(
  type: string,
  payload: Readonly<Record<string, unknown>>,
  options: { readonly enabled?: boolean } = {},
): UseQueryResult<TData> {
  const { refreshIntervalMs, register } = useContext(DashboardQueryContext);
  const enabled = options.enabled ?? true;
  const result = useQuery<TData>(type, payload, {
    live: true,
    enabled,
    ...(refreshIntervalMs !== undefined && { refetchIntervalMs: refreshIntervalMs }),
  });
  const { refetch } = result;
  useEffect(() => (enabled ? register(refetch) : undefined), [enabled, register, refetch]);
  return result;
}

export type DashboardFormats = {
  readonly timeZone: string;
  readonly formatNumber: (value: number) => string;
  readonly formatPercent: (fraction: number) => string;
  readonly formatDay: (atMs: number) => string;
  readonly formatMonth: (atMs: number) => string;
  readonly formatHour: (atMs: number) => string;
  readonly formatDateTime: (atMs: number) => string;
  readonly formatMedium: (atMs: number) => string;
  readonly formatMinor: (amountMinor: number, currency: string, fractionDigits?: number) => string;
  /** "5 minutes ago"; the component that called `useDashboardFormats` redraws on a
   *  timer while at least one of its renders used this. */
  readonly formatRelative: (atMs: number) => string;
  /** Number formatter for a panel; currency when `valueFormat` is set. */
  readonly formatPanelValue: (
    valueFormat: DashboardCurrencyFormat | undefined,
  ) => (value: number) => string;
  /** Compact variant of `formatPanelValue` for chart axes ("1,5 Mio. €"). */
  readonly formatPanelAxisValue: (
    valueFormat: DashboardCurrencyFormat | undefined,
  ) => (value: number) => string;
};

export function useDashboardFormats(): DashboardFormats {
  const resolver = useLocale();
  const locale = resolver.locale();
  const timeZone = resolver.timeZone();
  const formatRelative = useRelativeTimeFormatter(locale);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  // Without the significant-digit cap, values below the locale's first
  // abbreviation step keep a decimal ("298.989,9 €" in de); lessPrecision
  // picks whichever rule rounds more, so that becomes "299.000 €" while
  // "1,5 Mio. €" keeps its one decimal.
  const compactOptions = {
    notation: "compact",
    maximumFractionDigits: 1,
    maximumSignificantDigits: 3,
    roundingPriority: "lessPrecision",
  } as const satisfies Intl.NumberFormatOptions;
  const compactNumber = new Intl.NumberFormat(locale, compactOptions);
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const day = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", timeZone });
  const month = new Intl.DateTimeFormat(locale, { month: "2-digit", year: "numeric", timeZone });
  const hour = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone });
  const dateTime = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
  const medium = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone });
  const formatMinor = (amountMinor: number, currency: string, fractionDigits?: number): string =>
    formatMoney(amountMinor, currency, locale, fractionDigits);
  return {
    timeZone,
    formatMedium: (atMs) => medium.format(atMs),
    formatMinor,
    formatRelative,
    formatPanelValue: (valueFormat) =>
      valueFormat === undefined
        ? (value) => number.format(value)
        : (value) => formatMinor(value, valueFormat.currency, valueFormat.fractionDigits),
    formatPanelAxisValue: (valueFormat) => {
      if (valueFormat === undefined || !CURRENCY_CODE_PATTERN.test(valueFormat.currency)) {
        return (value) => compactNumber.format(value);
      }
      const compactMoney = new Intl.NumberFormat(resolveSafeLocale(locale), {
        ...compactOptions,
        style: "currency",
        currency: valueFormat.currency,
      });
      const decimals = currencyDecimals(valueFormat.currency);
      return (value) => compactMoney.format(value / 10 ** decimals);
    },
    formatNumber: (value) => number.format(value),
    formatPercent: (fraction) => percent.format(fraction),
    formatDay: (atMs) => day.format(atMs),
    formatMonth: (atMs) => month.format(atMs),
    formatHour: (atMs) => hour.format(atMs),
    formatDateTime: (atMs) => dateTime.format(atMs),
  };
}

export function PanelShell({
  testId,
  title,
  subtitle,
  action,
  children,
}: {
  readonly testId: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section
      data-testid={testId}
      className="flex h-full flex-col rounded-lg border border-border bg-card text-card-foreground"
    >
      <header className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border-row px-4 py-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-sm font-semibold break-words">{title}</h2>
          {subtitle !== undefined && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action !== undefined && <div className="shrink-0">{action}</div>}
      </header>
      <div className="grow p-4">{children}</div>
    </section>
  );
}

export function PanelError({
  label,
  error,
  onRetry,
  testId,
}: {
  readonly label: string;
  readonly error: Parameters<typeof dispatcherErrorText>[0];
  readonly onRetry: () => void;
  readonly testId?: string;
}): ReactNode {
  const { Button } = usePrimitives();
  const t = useTranslation();
  return (
    <div
      role="alert"
      data-testid={testId}
      className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-status-bad/40 px-4 py-6 text-sm"
    >
      <div className="font-medium text-status-bad">
        {t("kumiko.dashboard.panel.error.title", { label })}
      </div>
      <div className="text-muted-foreground">{dispatcherErrorText(error, t)}</div>
      <Button variant="secondary" onClick={onRetry}>
        {t("kumiko.dashboard.panel.error.retry")}
      </Button>
      <div className="text-xs text-muted-foreground">
        {t("kumiko.dashboard.panel.error.isolated")}
      </div>
    </div>
  );
}

type SkeletonShape = "bars" | "segments" | "rows";

function PanelSkeleton({ shape }: { readonly shape: SkeletonShape }): ReactNode {
  const t = useTranslation();
  if (shape === "rows") return <LoadingState rows={3} />;
  if (shape === "segments") {
    return (
      <output aria-label={t("kumiko.widget.loading")} className="flex flex-col gap-4">
        {SKELETON_SEGMENT_WIDTHS.map((width) => (
          <div key={width} className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 rounded-full" style={{ width }} />
          </div>
        ))}
      </output>
    );
  }
  return (
    <output aria-label={t("kumiko.widget.loading")} className="flex h-40 items-end gap-1">
      {SKELETON_BAR_HEIGHTS.map((height) => (
        <Skeleton key={height} className="flex-1" style={{ height }} />
      ))}
    </output>
  );
}

type QueryPanelProps<TData> = {
  readonly panel: DashboardPanelQueryOptions &
    DashboardPanelEmptyState & { readonly id: string; readonly query: string };
  readonly label: string;
  readonly subtitle?: string;
  readonly action?: ReactNode;
  readonly screenParams: ScreenParams;
  readonly translate: Translate;
  readonly skeleton: SkeletonShape;
  readonly isEmpty: (data: TData) => boolean;
  /** Receives the formats of the panel itself, so a relative time inside the body
   *  redraws this panel and nothing else. */
  readonly children: (data: TData, formats: DashboardFormats) => ReactNode;
};

export function QueryPanel<TData>({
  panel,
  label,
  subtitle,
  action,
  screenParams,
  translate,
  skeleton,
  isEmpty,
  children,
}: QueryPanelProps<TData>): ReactNode {
  const formats = useDashboardFormats();
  const { data, error, loading, refetch } = useDashboardQuery<TData>(
    panel.query,
    panelPayload(panel, screenParams),
  );
  useReportPanelLoaded(data);
  let body: ReactNode;
  if (loading && data === null) {
    body = <PanelSkeleton shape={skeleton} />;
  } else if (error !== null) {
    body = <PanelError label={label} error={error} onRetry={() => void refetch()} />;
  } else if (data === null || isEmpty(data)) {
    body = (
      <EmptyState
        title={translate(panel.emptyLabel ?? "kumiko.list.no-entries")}
        description={panel.emptyHint !== undefined ? translate(panel.emptyHint) : undefined}
      />
    );
  } else {
    body = children(data, formats);
  }
  return (
    <PanelShell
      testId={`dashboard-panel-${panel.id}`}
      title={label}
      subtitle={subtitle}
      action={action}
    >
      {body}
    </PanelShell>
  );
}

// Starts at render time and restarts whenever the merged query params change;
// panels additionally report each successful (re)load, so live refetches and
// retries keep the stamp current.
export function useLoadedAt(screenParams: ScreenParams): {
  readonly loadedAtMs: number;
  readonly reportLoaded: (atMs: number) => void;
} {
  const paramsKey = JSON.stringify([
    screenParams.filterParams,
    screenParams.rangeParams,
    screenParams.recordParams,
  ]);
  const [loaded, setLoaded] = useState(() => ({ paramsKey, atMs: Date.now() }));
  if (loaded.paramsKey !== paramsKey) setLoaded({ paramsKey, atMs: Date.now() });
  const reportLoaded = useCallback(
    (atMs: number) => setLoaded((prev) => (prev.atMs >= atMs ? prev : { ...prev, atMs })),
    [],
  );
  return { loadedAtMs: loaded.atMs, reportLoaded };
}

export const PanelLoadedContext = createContext<(atMs: number) => void>(() => {});

export function useReportPanelLoaded(data: unknown): void {
  const reportLoaded = useContext(PanelLoadedContext);
  useEffect(() => {
    if (data !== null) reportLoaded(Date.now());
  }, [data, reportLoaded]);
}
