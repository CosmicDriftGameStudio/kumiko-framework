import type { NavIconKey } from "@cosmicdrift/kumiko-framework/ui-types";
import type { DashboardStatTone } from "@cosmicdrift/kumiko-types/screen";
import type { ReactNode } from "react";

/** Compact label/value tile (record-detail metrics band). `testId` is the
 *  tile's own id — the impl derives `${testId}-label`/`${testId}-value` for
 *  the two rendered nodes, so a caller only ever needs to know the base id. */
export type MetricProps = {
  readonly label: string;
  readonly value: string;
  readonly testId?: string;
  /** Click handler — set when the metric declares a `navigate` target
   *  (see `MetricSpec`). Omitted for a plain, non-interactive metric. */
  readonly onPress?: () => void;
  /** Draw as a KPI tile (the dashboard StatCard) instead of a band entry. */
  readonly tile?: boolean;
  readonly tone?: DashboardStatTone;
  readonly icon?: NavIconKey;
};

/** Band above the tabs of a record detail: optional subtitle line plus the
 *  metrics as a definition list. `children` are `Metric` tiles. */
export type MetricBandProps = {
  /** Free-form block rendered unstyled as the first full-width row of the band. */
  readonly lead?: ReactNode;
  readonly subtitle?: ReactNode;
  readonly children: ReactNode;
  /** The children are KPI tiles, laid out as a tile grid instead of a definition list. */
  readonly tiles?: boolean;
  readonly testId?: string;
};
