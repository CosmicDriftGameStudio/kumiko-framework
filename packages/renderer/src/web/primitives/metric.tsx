import { Children, createContext, type ReactNode, useContext } from "react";
import type { MetricBandProps, MetricProps } from "../../index.ts";
import { Icon } from "../icons.tsx";
import { cn } from "../lib/cn.ts";
import { StatCard } from "../widgets/stat.tsx";

// Two tiles per row on phones, then the dashboard stat-group fill.
const METRIC_TILE_GRID_CLASSES =
  "grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fit,minmax(min(12rem,100%),1fr))]";

const InsideMetricBandContext = createContext(false);

// The screen-form column already insets and spaces its children; a band in its
// header region must not add its own padding on top. DefaultCard resets this
// to false because a card body is a different inset surface.
export const InsideScreenFormColumnContext = createContext(false);

// Band column counts follow the board: 2 below md, 3 below lg, 5 from lg.
export function DefaultMetricBand({
  lead,
  subtitle,
  children,
  testId,
  tiles,
}: MetricBandProps): ReactNode {
  const insideScreenFormColumn = useContext(InsideScreenFormColumnContext);
  const hasMetrics = Children.toArray(children).length > 0;
  return (
    <div
      className={cn("flex shrink-0 flex-col gap-3", !insideScreenFormColumn && "px-6 pb-4 pt-3.5")}
      data-testid={testId}
    >
      {lead !== undefined && <div data-kumiko-layout="metric-band-lead">{lead}</div>}
      {subtitle !== undefined && (
        <div className="flex flex-wrap items-center gap-x-2 text-[13px] text-foreground-secondary [&_a]:text-primary">
          {subtitle}
        </div>
      )}
      {hasMetrics &&
        (tiles === true ? (
          <div className={METRIC_TILE_GRID_CLASSES}>{children}</div>
        ) : (
          <InsideMetricBandContext.Provider value={true}>
            <dl className="m-0 grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-5">{children}</dl>
          </InsideMetricBandContext.Provider>
        ))}
    </div>
  );
}

function MetricTile({ label, value, testId, onPress, tone, icon, sub }: MetricProps): ReactNode {
  const card = (
    <StatCard
      label={label}
      value={value}
      {...(sub !== undefined && { sub })}
      {...(icon !== undefined && { icon: <Icon name={icon} className="size-4" /> })}
      {...(tone !== undefined && { tone })}
      {...(testId !== undefined && { testId })}
    />
  );
  return onPress !== undefined ? (
    <button type="button" className="text-left" onClick={onPress}>
      {card}
    </button>
  ) : (
    card
  );
}

export function DefaultMetric(props: MetricProps): ReactNode {
  const insideBand = useContext(InsideMetricBandContext);
  if (props.tile === true) return <MetricTile {...props} />;
  const { label, value, testId, onPress, sub } = props;
  const item = (
    <div
      data-testid={testId}
      className={cn("flex min-w-0 flex-col gap-0.5", onPress !== undefined && "cursor-pointer")}
      {...(onPress !== undefined && { onClick: onPress })}
    >
      <dt
        className="text-xs text-muted-foreground"
        data-testid={testId !== undefined ? `${testId}-label` : undefined}
      >
        {label}
      </dt>
      <dd
        className="m-0 text-base font-medium tabular-nums text-foreground"
        data-testid={testId !== undefined ? `${testId}-value` : undefined}
      >
        {onPress !== undefined ? (
          <button type="button" className="text-left hover:underline">
            {value}
          </button>
        ) : (
          value
        )}
        {sub !== undefined && (
          <span
            className="block text-xs font-normal text-muted-foreground"
            data-testid={testId !== undefined ? `${testId}-sub` : undefined}
          >
            {sub}
          </span>
        )}
      </dd>
    </div>
  );
  return insideBand ? item : <dl className="m-0">{item}</dl>;
}
