// @runtime client
// Paginated tenant-scoped audit log (event store).

import { useDispatcher, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { AuditQueries } from "../constants";

type AuditRow = {
  readonly id: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly type: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly payload: Record<string, unknown>;
};

type AuditResponse = { readonly rows: readonly AuditRow[]; readonly nextBefore: string | null };

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly rows: readonly AuditRow[]; readonly nextBefore: string | null };

export function AuditLogScreen(): ReactNode {
  const t = useTranslation();
  const dispatcher = useDispatcher();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [before, setBefore] = useState<string | undefined>(undefined);

  const load = useCallback(
    async (cursor?: string): Promise<void> => {
      setState({ kind: "loading" });
      const res = await dispatcher.query<AuditResponse>(AuditQueries.list, {
        limit: 50,
        ...(cursor !== undefined && { before: cursor }),
      });
      if (!res.isSuccess) {
        setState({ kind: "error", message: res.error.message });
        return;
      }
      setState({ kind: "ready", rows: res.data.rows, nextBefore: res.data.nextBefore });
    },
    [dispatcher],
  );

  useEffect(() => {
    void load(before);
  }, [load, before]);

  if (state.kind === "loading") return <p>{t("audit.log.loading")}</p>;
  if (state.kind === "error") return <p style={{ color: "#b91c1c" }}>{state.message}</p>;

  return (
    <div data-testid="audit-log-screen" className="p-6 flex flex-col gap-4 max-w-5xl">
      <h1 className="text-2xl font-semibold m-0">{t("audit.log.title")}</h1>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">{t("audit.log.col.when")}</th>
            <th className="p-2">{t("audit.log.col.type")}</th>
            <th className="p-2">{t("audit.log.col.aggregate")}</th>
            <th className="p-2">{t("audit.log.col.actor")}</th>
          </tr>
        </thead>
        <tbody>
          {state.rows.map((row) => (
            <tr key={row.id} className="border-b border-muted" data-audit-id={row.id}>
              <td className="p-2 whitespace-nowrap">{formatWhen(row.createdAt)}</td>
              <td className="p-2">
                <code>{row.type}</code>
              </td>
              <td className="p-2">
                <code>{row.aggregateType}</code>
                <span className="text-muted-foreground"> / </span>
                <code className="text-xs">{row.aggregateId}</code>
              </td>
              <td className="p-2">
                <code className="text-xs">{row.createdBy}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {state.rows.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("audit.log.empty")}</p>
      )}
      <div className="flex gap-2">
        {before !== undefined && (
          <button
            type="button"
            className="border rounded px-3 py-1 text-sm"
            onClick={() => setBefore(undefined)}
            data-testid="audit-log-newest"
          >
            {t("audit.log.newest")}
          </button>
        )}
        {state.nextBefore !== null && (
          <button
            type="button"
            className="border rounded px-3 py-1 text-sm"
            onClick={() => setBefore(state.nextBefore ?? undefined)}
            data-testid="audit-log-older"
          >
            {t("audit.log.older")}
          </button>
        )}
      </div>
    </div>
  );
}

function formatWhen(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}
