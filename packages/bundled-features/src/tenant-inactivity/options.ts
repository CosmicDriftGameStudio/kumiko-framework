import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type { InactivityRule } from "./inactivity-plan.ts";

/** Newest activity an app knows outside this app's sessions (for example a sibling app); null when none. */
export type TenantActivitySource = (args: {
  readonly tenantId: TenantId;
  readonly now: Temporal.Instant;
}) => Promise<Temporal.Instant | null>;

type SharedOptions = {
  /** HMAC key of the keep-account links. Unset: mails link to keepAccountUrl without a token. */
  readonly keepAccountTokenSecret?: string;
  /** App page that reads the `#token=` fragment and calls the keep-account handler. */
  readonly keepAccountUrl: string;
  /** Name shown in the mails; defaults to a generic word per locale. */
  readonly appName?: string;
  readonly activitySources?: readonly TenantActivitySource[];
};

export type TenantInactivityOptions<TTier extends string = string> = SharedOptions &
  (
    | { readonly rule: InactivityRule }
    | {
        readonly resolveTier: (db: TenantDb) => Promise<TTier>;
        /** null exempts the tier (paid plans). */
        readonly rulesByTier: Readonly<Record<TTier, InactivityRule | null>>;
      }
  );

export async function resolveInactivityRule<TTier extends string>(
  options: TenantInactivityOptions<TTier>,
  db: TenantDb,
): Promise<InactivityRule | null> {
  if ("rule" in options) return options.rule;
  return options.rulesByTier[await options.resolveTier(db)];
}
