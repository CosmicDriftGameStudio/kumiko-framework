// @runtime client
import { useDispatcher, useTranslation } from "@cosmicdrift/kumiko-renderer";
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

  if (state.kind === "loading") return <p>{t("feature-toggles.admin.loading")}</p>;
  if (state.kind === "error") return <p style={{ color: "#b91c1c" }}>{state.message}</p>;

  return (
    <div data-testid="toggle-admin-screen" className="p-6 flex flex-col gap-4 max-w-5xl">
      <h1 className="text-2xl font-semibold m-0">{t("feature-toggles.admin.title")}</h1>
      {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">{t("feature-toggles.admin.col.feature")}</th>
            <th className="p-2">{t("feature-toggles.admin.col.default")}</th>
            <th className="p-2">{t("feature-toggles.admin.col.override")}</th>
            <th className="p-2">{t("feature-toggles.admin.col.effective")}</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {state.items.map((row) => (
            <tr key={row.name} className="border-b border-muted" data-feature-name={row.name}>
              <td className="p-2">
                <code>{row.name}</code>
              </td>
              <td className="p-2">{formatFlag(row.default)}</td>
              <td className="p-2">{formatFlag(row.override)}</td>
              <td className="p-2">{formatFlag(row.effective)}</td>
              <td className="p-2">
                {row.toggleable ? (
                  <button
                    type="button"
                    disabled={saving === row.name}
                    className="border rounded px-3 py-1 text-xs"
                    onClick={() => void onSet(row.name, !(row.effective ?? row.default ?? false))}
                    data-testid={`toggle-${row.name}`}
                  >
                    {saving === row.name
                      ? t("feature-toggles.admin.saving")
                      : t("feature-toggles.admin.toggle")}
                  </button>
                ) : (
                  <span className="text-muted-foreground text-xs">
                    {t("feature-toggles.admin.alwaysOn")}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatFlag(value: boolean | null): string {
  if (value === null) return "inherit";
  return value ? "on" : "off";
}
