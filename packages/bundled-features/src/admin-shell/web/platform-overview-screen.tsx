// @runtime client

import { useDispatcher, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useEffect, useState } from "react";
import { JobQueries } from "../../jobs/constants";
import { TenantQueries } from "../../tenant/constants";
import { OverviewLayout, type OverviewState } from "./overview-layout";
import { overviewQuery } from "./overview-query";

export function PlatformOverviewScreen(): ReactNode {
  const t = useTranslation();
  const dispatcher = useDispatcher();
  const [state, setState] = useState<OverviewState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      const tenantsRes = await overviewQuery<{ readonly rows: readonly unknown[] }>(
        "platform",
        dispatcher,
        TenantQueries.list,
        {},
      );
      if (cancelled) return;
      if (!tenantsRes.isSuccess) {
        setState({ kind: "error", message: tenantsRes.error.message });
        return;
      }

      const failedJobsRes = await overviewQuery<{ readonly rows: readonly unknown[] }>(
        "platform",
        dispatcher,
        JobQueries.list,
        { status: "failed", limit: 50 },
      );
      if (cancelled) return;
      if (!failedJobsRes.isSuccess) {
        setState({ kind: "error", message: failedJobsRes.error.message });
        return;
      }

      setState({
        kind: "ready",
        cards: [
          {
            label: t("admin-shell:overview.tenants"),
            value: String(tenantsRes.data.rows.length),
          },
          {
            label: t("admin-shell:overview.failedJobs"),
            value: String(failedJobsRes.data.rows.length),
            hint:
              failedJobsRes.data.rows.length > 0
                ? t("admin-shell:overview.failedJobsHint")
                : undefined,
            attention: failedJobsRes.data.rows.length > 0,
          },
        ],
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatcher, t]);

  return (
    <OverviewLayout
      testId="platform-overview-screen"
      title={t("admin-shell:overview.platformTitle")}
      state={state}
      loadingLabel={t("admin-shell:overview.loading")}
      columns={2}
    />
  );
}
