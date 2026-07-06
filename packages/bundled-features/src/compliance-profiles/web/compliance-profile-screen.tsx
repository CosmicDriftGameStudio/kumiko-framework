// @runtime client
import { useDispatcher, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ComplianceProfileHandlers, ComplianceProfileQueries } from "../constants";

type ProfileSummary = {
  readonly key: string;
  readonly region: string;
  readonly label: string;
  readonly authorityContact: string;
};

type ListProfilesResponse = {
  readonly profiles: readonly ProfileSummary[];
};

type CurrentProfileResponse = {
  readonly key: string;
  readonly label: string;
  readonly region: string;
  readonly warning?: string;
};

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly profiles: readonly ProfileSummary[];
      readonly current: CurrentProfileResponse | null;
    };

export function ComplianceProfileScreen(): ReactNode {
  const t = useTranslation();
  const dispatcher = useDispatcher();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    const [profilesRes, currentRes] = await Promise.all([
      dispatcher.query<ListProfilesResponse>(ComplianceProfileQueries.listProfiles, {}),
      dispatcher.query<CurrentProfileResponse>(ComplianceProfileQueries.forTenant, {}),
    ]);
    if (!profilesRes.isSuccess) {
      setState({ kind: "error", message: profilesRes.error.message });
      return;
    }
    if (!currentRes.isSuccess) {
      setState({ kind: "error", message: currentRes.error.message });
      return;
    }
    setSelected(currentRes.data.key);
    setState({ kind: "ready", profiles: profilesRes.data.profiles, current: currentRes.data });
  }, [dispatcher]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSave = async (): Promise<void> => {
    if (selected === "") return;
    setActionError(null);
    setSaving(true);
    const res = await dispatcher.write(ComplianceProfileHandlers.setProfile, {
      profileKey: selected,
    });
    setSaving(false);
    if (!res.isSuccess) {
      setActionError(res.error.message);
      return;
    }
    await load();
  };

  if (state.kind === "loading") return <p>{t("compliance.profile.loading")}</p>;
  if (state.kind === "error") return <p style={{ color: "#b91c1c" }}>{state.message}</p>;

  return (
    <div data-testid="compliance-profile-screen" className="p-6 flex flex-col gap-4 max-w-3xl">
      <h1 className="text-2xl font-semibold m-0">{t("compliance.profile.title")}</h1>
      {state.current ? (
        <p className="text-sm text-muted-foreground" data-testid="compliance-current-profile">
          {t("compliance.profile.current")}: {state.current.label} ({state.current.key})
        </p>
      ) : null}
      <label className="flex flex-col gap-1 text-sm max-w-md">
        {t("compliance.profile.select")}
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="border rounded px-2 py-1"
          data-testid="compliance-profile-select"
        >
          {state.profiles.map((profile) => (
            <option key={profile.key} value={profile.key}>
              {profile.label} ({profile.key})
            </option>
          ))}
        </select>
      </label>
      <ul className="text-sm flex flex-col gap-2">
        {state.profiles.map((profile) => (
          <li key={profile.key} data-profile-key={profile.key}>
            <strong>{profile.label}</strong> - {profile.region} - {profile.authorityContact}
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={saving || selected === ""}
          className="bg-primary text-primary-foreground rounded px-4 py-2 font-medium w-fit"
          onClick={() => void onSave()}
          data-testid="compliance-profile-save"
        >
          {saving ? t("compliance.profile.saving") : t("compliance.profile.save")}
        </button>
        {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
      </div>
    </div>
  );
}
