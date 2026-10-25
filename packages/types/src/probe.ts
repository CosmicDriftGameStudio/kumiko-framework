import type { JobContext } from "./handlers.ts";
import type { TenantId } from "./identifiers.ts";

export type ProbeScope = "tenant" | "system";
export type ProbeCost = "free" | "paid";

export type ProbeText = {
  readonly key: string;
  readonly params?: Readonly<Record<string, string | number>>;
};

export type ProbeTarget = {
  readonly id: string;
  readonly label: ProbeText;
  readonly ownerUserId?: string;
};

export type ProbeVerdict =
  | { readonly status: "ok"; readonly message: ProbeText }
  | { readonly status: "skipped"; readonly message: ProbeText };

export type ProbeContext = JobContext & {
  readonly probeRunId: string;
  readonly tenantId: TenantId;
  readonly triggeredByUserId: string;
  readonly triggeredByEmail: string | undefined;
};

export type ProbeOptions = {
  readonly name: string;
  readonly scope: ProbeScope;
  readonly cost: ProbeCost;
  /** i18n key, column "Bereich" */
  readonly area: string;
  /** i18n key, column "Check" (used when the probe has no targets) */
  readonly label: string;
  /** Default 10_000 */
  readonly timeoutMs?: number;
  /** Screen QN linked from a failed result */
  readonly fixScreen?: string;
  readonly targets?: (ctx: ProbeContext) => Promise<readonly ProbeTarget[]>;
  /** Failure = throw */
  readonly run: (ctx: ProbeContext, target: ProbeTarget | undefined) => Promise<ProbeVerdict>;
};

export type ProbeDefinition = ProbeOptions & { readonly qualifiedName: string };
