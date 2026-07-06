// @runtime client
import { ConfigQueries } from "../../config/constants";
import { TenantQueries } from "../../tenant/constants";
import { useDispatcher, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useEffect, useState } from "react";
import { OverviewLayout, type OverviewState } from "./overview-layout";
import { overviewQuery } from "./overview-query";

export function TenantOverviewScreen(): ReactNode {
  const t = useTranslation();
  const dispatcher = useDispatcher();
  const [state, setState] = useState<OverviewState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      const invitationsRes = await overviewQuery<readonly unknown[]>(
        "tenant",
        dispatcher,
        TenantQueries.invitations,
        {},
      );
      if (cancelled) return;
      if (!invitationsRes.isSuccess) {
        setState({ kind: "error", message: invitationsRes.error.message });
        return;
      }

      const membersRes = await overviewQuery<readonly unknown[]>(
        "tenant",
        dispatcher,
        TenantQueries.members,
        {},
      );
      if (cancelled) return;
      if (!membersRes.isSuccess) {
        setState({ kind: "error", message: membersRes.error.message });
        return;
      }

      const readinessRes = await overviewQuery<{ readonly missing: readonly unknown[] }>(
        "tenant",
        dispatcher,
        ConfigQueries.readiness,
        {},
      );
      if (cancelled) return;
      if (!readinessRes.isSuccess) {
        setState({ kind: "error", message: readinessRes.error.message });
        return;
      }

      setState({
        kind: "ready",
        cards: [
          {
            label: t("admin-shell:overview.pendingInvitations"),
            value: String(invitationsRes.data.length),
          },
          {
            label: t("admin-shell:overview.members"),
            value: String(membersRes.data.length),
          },
          {
            label: t("admin-shell:overview.missingConfig"),
            value: String(readinessRes.data.missing.length),
            hint:
              readinessRes.data.missing.length > 0
                ? t("admin-shell:overview.missingConfigHint")
                : undefined,
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
      testId="tenant-overview-screen"
      title={t("admin-shell:overview.tenantTitle")}
      state={state}
      loadingLabel={t("admin-shell:overview.loading")}
    />
  );
}
