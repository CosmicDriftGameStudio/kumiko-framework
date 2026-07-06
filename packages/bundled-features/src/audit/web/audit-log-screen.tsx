// @runtime client
// Paginated tenant-scoped audit log (event store).

import { useDispatcher, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { FormScreenShell } from "@cosmicdrift/kumiko-renderer-web";
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
  | {
      readonly kind: "ready";
      readonly rows: readonly AuditRow[];
      readonly nextBefore: string | null;
    };

export function AuditLogScreen(): ReactNode {
  const t = useTranslation();
  const { Banner, Button, Card, DataTable, Heading, Text } = usePrimitives();
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

  if (state.kind === "loading") {
    return (
      <FormScreenShell testId="audit-log-screen">
        <Text variant="small">{t("audit.log.loading")}</Text>
      </FormScreenShell>
    );
  }

  if (state.kind === "error") {
    return (
      <FormScreenShell testId="audit-log-screen">
        <Banner variant="error">{state.message}</Banner>
      </FormScreenShell>
    );
  }

  return (
    <FormScreenShell testId="audit-log-screen" className="flex max-w-5xl flex-col gap-6">
      <Heading variant="page">{t("audit.log.title")}</Heading>

      <Card options={{ padded: false }}>
        <DataTable
          testId="audit-log-table"
          columns={[
            { field: "when", label: t("audit.log.col.when"), type: "string", sortable: false },
            { field: "type", label: t("audit.log.col.type"), type: "string", sortable: false },
            {
              field: "aggregate",
              label: t("audit.log.col.aggregate"),
              type: "string",
              sortable: false,
            },
            { field: "actor", label: t("audit.log.col.actor"), type: "string", sortable: false },
          ]}
          rows={state.rows.map((row) => ({
            id: row.id,
            values: {
              when: formatWhen(row.createdAt),
              type: row.type,
              aggregate: `${row.aggregateType} / ${row.aggregateId}`,
              actor: row.createdBy,
            },
          }))}
          emptyState={<Text variant="small">{t("audit.log.empty")}</Text>}
        />
      </Card>

      <div className="flex gap-2">
        {before !== undefined && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setBefore(undefined)}
            testId="audit-log-newest"
          >
            {t("audit.log.newest")}
          </Button>
        )}
        {state.nextBefore !== null && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setBefore(state.nextBefore ?? undefined)}
            testId="audit-log-older"
          >
            {t("audit.log.older")}
          </Button>
        )}
      </div>
    </FormScreenShell>
  );
}

function formatWhen(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}
