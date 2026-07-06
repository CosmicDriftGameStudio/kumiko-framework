// @runtime client
import { useDispatcher, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { FormScreenShell } from "@cosmicdrift/kumiko-renderer-web";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { FeatureToggleHandlers, FeatureToggleQueries } from "../constants";

type ToggleRow = {
  readonly name: string;
  readonly toggleable: boolean;
  readonly default: boolean | null;
  readonly override: boolean | null;
  readonly effective: boolean | null;
};

type RegisteredResponse = {
  readonly items: readonly ToggleRow[];
};

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly items: readonly ToggleRow[] };

export function ToggleAdminScreen(): ReactNode {
  const t = useTranslation();
  const { Banner, Card, DataTable, Heading, Text } = usePrimitives();
  const dispatcher = useDispatcher();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    const res = await dispatcher.query<RegisteredResponse>(FeatureToggleQueries.registered, {});
    if (!res.isSuccess) {
      setState({ kind: "error", message: res.error.message });
      return;
    }
    setState({ kind: "ready", items: res.data.items });
  }, [dispatcher]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSet = async (featureName: string, enabled: boolean): Promise<void> => {
    setActionError(null);
    const res = await dispatcher.write(FeatureToggleHandlers.set, { featureName, enabled });
    if (!res.isSuccess) {
      setActionError(res.error.message);
      return;
    }
    await load();
  };

  if (state.kind === "loading") {
    return (
      <FormScreenShell testId="toggle-admin-screen">
        <Text variant="small">{t("feature-toggles.admin.loading")}</Text>
      </FormScreenShell>
    );
  }

  if (state.kind === "error") {
    return (
      <FormScreenShell testId="toggle-admin-screen">
        <Banner variant="error">{state.message}</Banner>
      </FormScreenShell>
    );
  }

  return (
    <FormScreenShell testId="toggle-admin-screen" className="flex max-w-5xl flex-col gap-6">
      <Heading variant="page">{t("feature-toggles.admin.title")}</Heading>

      {actionError !== null && <Banner variant="error">{actionError}</Banner>}

      <Card options={{ padded: false }}>
        <DataTable
          testId="toggle-admin-table"
          columns={[
            {
              field: "feature",
              label: t("feature-toggles.admin.col.feature"),
              type: "string",
              sortable: false,
            },
            {
              field: "default",
              label: t("feature-toggles.admin.col.default"),
              type: "string",
              sortable: false,
            },
            {
              field: "override",
              label: t("feature-toggles.admin.col.override"),
              type: "string",
              sortable: false,
            },
            {
              field: "effective",
              label: t("feature-toggles.admin.col.effective"),
              type: "string",
              sortable: false,
            },
          ]}
          rows={state.items.map((row) => ({
            id: row.name,
            values: {
              feature: row.name,
              default: formatFlag(row.default),
              override: formatFlag(row.override),
              effective: formatFlag(row.effective),
              toggleable: row.toggleable,
              effectiveBool: row.effective ?? row.default ?? false,
            },
          }))}
          rowActions={[
            {
              id: "toggle",
              label: t("feature-toggles.admin.toggle"),
              style: "secondary",
              isVisible: (row) => row.values["toggleable"] === true,
              onTrigger: (row) => void onSet(row.id, !(row.values["effectiveBool"] as boolean)),
            },
          ]}
          rowActionMode="inline"
        />
      </Card>
    </FormScreenShell>
  );
}

function formatFlag(value: boolean | null): string {
  if (value === null) return "inherit";
  return value ? "on" : "off";
}
