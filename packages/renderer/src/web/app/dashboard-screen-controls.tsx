import type { DashboardScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import type { Translate } from "../../headless/index.ts";
import { useLocale, useNav, usePrimitives, useQuery, useTranslation } from "../../index.ts";
import { ModeSwitch } from "../widgets/mode-switch.tsx";

// Value lives in the URL under `filter.id` (like useListUrlState's
// `<screenId>.page`, same replaceState) so a `navigate` rowAction with
// `params` can deep-link onto this filter.
export function useFilterParams(
  screen: DashboardScreenDefinition,
  enabled: boolean,
): {
  readonly params: Readonly<Record<string, unknown>>;
  readonly picker: ReactNode;
} {
  const { Field, Input } = usePrimitives();
  const t = useTranslation();
  const nav = useNav();
  const filter = screen.filter;
  const value = filter !== undefined ? (nav.searchParams[filter.id] ?? "") : "";
  const optionsQueryResult = useQuery<{
    readonly rows: readonly { readonly value: string; readonly label: string }[];
  }>(filter?.optionsQuery ?? "", {}, { enabled: enabled && filter?.optionsQuery !== undefined });

  if (filter === undefined) {
    return { params: {}, picker: null };
  }

  const dynamicOptions =
    filter.optionsQuery !== undefined
      ? (optionsQueryResult.data?.rows ?? [])
      : (filter.options ?? []).map((o) => ({ value: o.value, label: t(o.label) }));
  const allLabel = t(filter.allLabel ?? "kumiko.dashboard.filter.all");
  const options = [{ value: "", label: allLabel }, ...dynamicOptions];

  const picker = (
    <div className="max-w-xs">
      <Field id={`dashboard-filter-${filter.id}`} label={t(filter.label)}>
        <Input
          kind="combobox"
          id={`dashboard-filter-${filter.id}`}
          name={filter.id}
          options={options}
          value={value}
          onChange={(next: string) =>
            nav.setSearchParams({ [filter.id]: next === "" ? null : next })
          }
          placeholder={filter.placeholder !== undefined ? t(filter.placeholder) : allLabel}
        />
      </Field>
    </div>
  );
  const params = value === "" ? {} : { [filter.id]: value };
  return { params, picker };
}

// An unknown/stale URL value falls back to the declared default.
export function useTimeRange(
  screen: DashboardScreenDefinition,
  translate: Translate,
): { readonly params: Readonly<Record<string, unknown>>; readonly control: ReactNode } {
  const t = useTranslation();
  const nav = useNav();
  const resolver = useLocale();
  const timeRange = screen.timeRange;
  if (timeRange === undefined) return { params: {}, control: null };
  const fromUrl = nav.searchParams[timeRange.id];
  const value = timeRange.options.find((o) => o.value === fromUrl)?.value ?? timeRange.default;
  return {
    // Metric buckets are cut server-side; without the user's zone they default
    // to UTC while the axis labels are formatted in the user's zone.
    params: { [timeRange.id]: value, timeZone: resolver.timeZone() },
    control: (
      <ModeSwitch
        value={value}
        options={timeRange.options.map((o) => ({ value: o.value, label: translate(o.label) }))}
        onChange={(next) => nav.setSearchParams({ [timeRange.id]: next })}
        ariaLabel={t("kumiko.dashboard.time-range")}
        testId={`dashboard-time-range-${timeRange.id}`}
      />
    ),
  };
}
