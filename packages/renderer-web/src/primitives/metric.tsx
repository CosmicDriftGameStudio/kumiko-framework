import type { MetricBandProps, MetricProps } from "@cosmicdrift/kumiko-renderer";
import { createContext, type ReactNode, useContext } from "react";
import { cn } from "../lib/cn.js";

const InsideMetricBandContext = createContext(false);

// Column counts follow the board: 2 below md, 3 below lg, 5 from lg.
export function DefaultMetricBand({
  lead,
  subtitle,
  children,
  testId,
}: MetricBandProps): ReactNode {
  return (
    <div className="flex shrink-0 flex-col gap-3 px-6 pb-4 pt-3.5" data-testid={testId}>
      {lead !== undefined && <div data-kumiko-layout="metric-band-lead">{lead}</div>}
      {subtitle !== undefined && (
        <div className="flex flex-wrap items-center gap-x-2 text-[13px] text-foreground-secondary [&_a]:text-primary">
          {subtitle}
        </div>
      )}
      <InsideMetricBandContext.Provider value={true}>
        <dl className="m-0 grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-5">{children}</dl>
      </InsideMetricBandContext.Provider>
    </div>
  );
}

export function DefaultMetric({ label, value, testId, onPress }: MetricProps): ReactNode {
  const insideBand = useContext(InsideMetricBandContext);
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
      </dd>
    </div>
  );
  return insideBand ? item : <dl className="m-0">{item}</dl>;
}
