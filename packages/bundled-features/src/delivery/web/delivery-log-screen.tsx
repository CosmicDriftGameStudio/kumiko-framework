// @runtime client
import { useDispatcher, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { DeliveryQueries } from "../constants";

type DeliveryRow = {
  readonly id: string;
  readonly notificationType: string;
  readonly channel: string;
  readonly recipientAddress: string | null;
  readonly status: string;
  readonly error: string | null;
};

type DeliveryLogResponse = {
  readonly rows: readonly DeliveryRow[];
};

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly rows: readonly DeliveryRow[] };

export function DeliveryLogScreen(): ReactNode {
  const t = useTranslation();
  const dispatcher = useDispatcher();
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    const res = await dispatcher.query<DeliveryLogResponse>(DeliveryQueries.log, { limit: 50 });
    if (!res.isSuccess) {
      setState({ kind: "error", message: res.error.message });
      return;
    }
    setState({ kind: "ready", rows: res.data.rows });
  }, [dispatcher]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "loading") return <p>{t("delivery.log.loading")}</p>;
  if (state.kind === "error") return <p style={{ color: "#b91c1c" }}>{state.message}</p>;

  return (
    <div data-testid="delivery-log-screen" className="p-6 flex flex-col gap-4 max-w-5xl">
      <h1 className="text-2xl font-semibold m-0">{t("delivery.log.title")}</h1>
      {state.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("delivery.log.empty")}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">{t("delivery.log.col.type")}</th>
              <th className="p-2">{t("delivery.log.col.channel")}</th>
              <th className="p-2">{t("delivery.log.col.recipient")}</th>
              <th className="p-2">{t("delivery.log.col.status")}</th>
            </tr>
          </thead>
          <tbody>
            {state.rows.map((row) => (
              <tr key={row.id} className="border-b border-muted" data-delivery-id={row.id}>
                <td className="p-2">
                  <code>{row.notificationType}</code>
                </td>
                <td className="p-2">{row.channel}</td>
                <td className="p-2">{row.recipientAddress ?? "—"}</td>
                <td className="p-2">
                  {row.status}
                  {row.error ? ` (${row.error})` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
