// @runtime client
import { useDispatcher, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { FormScreenShell } from "@cosmicdrift/kumiko-renderer-web";
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
  const { Banner, Card, Heading, Text } = usePrimitives();
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

  if (state.kind === "loading") {
    return (
      <FormScreenShell testId="delivery-log-screen">
        <Text variant="small">{t("delivery.log.loading")}</Text>
      </FormScreenShell>
    );
  }

  if (state.kind === "error") {
    return (
      <FormScreenShell testId="delivery-log-screen">
        <Banner variant="error">{state.message}</Banner>
      </FormScreenShell>
    );
  }

  return (
    <FormScreenShell testId="delivery-log-screen" className="flex max-w-5xl flex-col gap-6">
      <Heading variant="page">{t("delivery.log.title")}</Heading>

      {state.rows.length === 0 ? (
        <Text variant="small">{t("delivery.log.empty")}</Text>
      ) : (
        <Card options={{ padded: false }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-3">{t("delivery.log.col.type")}</th>
                <th className="p-3">{t("delivery.log.col.channel")}</th>
                <th className="p-3">{t("delivery.log.col.recipient")}</th>
                <th className="p-3">{t("delivery.log.col.status")}</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row) => (
                <tr key={row.id} className="border-b border-muted" data-delivery-id={row.id}>
                  <td className="p-3">
                    <Text variant="code">{row.notificationType}</Text>
                  </td>
                  <td className="p-3">{row.channel}</td>
                  <td className="p-3">{row.recipientAddress ?? "—"}</td>
                  <td className="p-3">
                    {row.status}
                    {row.error ? ` (${row.error})` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </FormScreenShell>
  );
}
