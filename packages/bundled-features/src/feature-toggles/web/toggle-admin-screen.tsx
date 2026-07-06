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
  const { Banner, Button, Card, Heading, Text } = usePrimitives();
  const dispatcher = useDispatcher();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [saving, setSaving] = useState<string | null>(null);
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
    setSaving(featureName);
    const res = await dispatcher.write(FeatureToggleHandlers.set, { featureName, enabled });
    setSaving(null);
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
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-3">{t("feature-toggles.admin.col.feature")}</th>
              <th className="p-3">{t("feature-toggles.admin.col.default")}</th>
              <th className="p-3">{t("feature-toggles.admin.col.override")}</th>
              <th className="p-3">{t("feature-toggles.admin.col.effective")}</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {state.items.map((row) => (
              <tr key={row.name} className="border-b border-muted" data-feature-name={row.name}>
                <td className="p-3">
                  <Text variant="code">{row.name}</Text>
                </td>
                <td className="p-3">{formatFlag(row.default)}</td>
                <td className="p-3">{formatFlag(row.override)}</td>
                <td className="p-3">{formatFlag(row.effective)}</td>
                <td className="p-3">
                  {row.toggleable ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={saving === row.name}
                      loading={saving === row.name}
                      onClick={() => void onSet(row.name, !(row.effective ?? row.default ?? false))}
                      testId={`toggle-${row.name}`}
                    >
                      {saving === row.name
                        ? t("feature-toggles.admin.saving")
                        : t("feature-toggles.admin.toggle")}
                    </Button>
                  ) : (
                    <Text variant="small">{t("feature-toggles.admin.alwaysOn")}</Text>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </FormScreenShell>
  );
}

function formatFlag(value: boolean | null): string {
  if (value === null) return "inherit";
  return value ? "on" : "off";
}
