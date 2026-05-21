import type { Role } from "../types";

export type ProbeLevel = "ok" | "warn" | "action";

export type ProbeReport = {
  /** Severity — drives icon + color in the Status-Dashboard. */
  readonly level: ProbeLevel;
  /** One-line summary, e.g. "12 stale test-DBs" or "all services up". */
  readonly summary: string;
  /** Optional multi-line context shown in the detail-pane. */
  readonly detail?: string;
};

export type StatusProbe = {
  /** Stable id for cursor + state-keying. */
  readonly id: string;
  /** Human label, shown in the list. */
  readonly label: string;
  /** Roles for which this probe is relevant. */
  readonly roles: ReadonlyArray<Role>;
  /** Async collector. Should be quick (< 1s) — probes refresh in
   *  parallel but a slow one blocks the row visually. */
  readonly collect: () => Promise<ProbeReport>;
};
