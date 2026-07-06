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
  const { Banner, Button, Card, Heading, Text } = usePrimitives();
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
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-3">{t("audit.log.col.when")}</th>
              <th className="p-3">{t("audit.log.col.type")}</th>
              <th className="p-3">{t("audit.log.col.aggregate")}</th>
              <th className="p-3">{t("audit.log.col.actor")}</th>
            </tr>
          </thead>
          <tbody>
            {state.rows.map((row) => (
              <tr key={row.id} className="border-b border-muted" data-audit-id={row.id}>
                <td className="p-3 whitespace-nowrap">{formatWhen(row.createdAt)}</td>
                <td className="p-3">
                  <Text variant="code">{row.type}</Text>
                </td>
                <td className="p-3">
                  <Text variant="code">{row.aggregateType}</Text>
                  <span className="text-muted-foreground"> / </span>
                  <Text variant="code">{row.aggregateId}</Text>
                </td>
                <td className="p-3">
                  <Text variant="code">{row.createdBy}</Text>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {state.rows.length === 0 && <Text variant="small">{t("audit.log.empty")}</Text>}

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
