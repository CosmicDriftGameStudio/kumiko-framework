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
  const { Banner, Card, DataTable, Heading, Text } = usePrimitives();
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

      <Card options={{ padded: false }}>
        <DataTable
          testId="delivery-log-table"
          columns={[
            { field: "type", label: t("delivery.log.col.type"), type: "string", sortable: false },
            {
              field: "channel",
              label: t("delivery.log.col.channel"),
              type: "string",
              sortable: false,
            },
            {
              field: "recipient",
              label: t("delivery.log.col.recipient"),
              type: "string",
              sortable: false,
            },
            {
              field: "status",
              label: t("delivery.log.col.status"),
              type: "string",
              sortable: false,
            },
          ]}
          rows={state.rows.map((row) => ({
            id: row.id,
            values: {
              type: row.notificationType,
              channel: row.channel,
              recipient: row.recipientAddress ?? "—",
              status: row.error ? `${row.status} (${row.error})` : row.status,
            },
          }))}
          emptyState={<Text variant="small">{t("delivery.log.empty")}</Text>}
        />
      </Card>
    </FormScreenShell>
  );
}
