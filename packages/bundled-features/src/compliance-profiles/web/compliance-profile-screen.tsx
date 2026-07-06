// @runtime client
import { useDispatcher, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { FormScreenShell } from "@cosmicdrift/kumiko-renderer-web";
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
  const { Banner, Button, Card, Field, Form, Heading, Input, Text } = usePrimitives();
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

  const onSave = (): void => {
    void (async (): Promise<void> => {
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
    })();
  };

  if (state.kind === "loading") {
    return (
      <FormScreenShell testId="compliance-profile-screen">
        <Text variant="small">{t("compliance.profile.loading")}</Text>
      </FormScreenShell>
    );
  }

  if (state.kind === "error") {
    return (
      <FormScreenShell testId="compliance-profile-screen">
        <Banner variant="error">{state.message}</Banner>
      </FormScreenShell>
    );
  }

  const profileOptions = state.profiles.map((profile) => ({
    value: profile.key,
    label: `${profile.label} (${profile.key})`,
  }));

  return (
    <FormScreenShell testId="compliance-profile-screen" className="flex flex-col gap-6">
      <Heading variant="page">{t("compliance.profile.title")}</Heading>

      {state.current !== null && (
        <Banner variant="info" testId="compliance-current-profile">
          {t("compliance.profile.current")}: {state.current.label} ({state.current.key})
        </Banner>
      )}

      <Form
        onSubmit={onSave}
        actions={
          <Button
            type="submit"
            variant="primary"
            disabled={saving || selected === ""}
            loading={saving}
            testId="compliance-profile-save"
          >
            {saving ? t("compliance.profile.saving") : t("compliance.profile.save")}
          </Button>
        }
      >
        <Field id="compliance-profile-select" label={t("compliance.profile.select")} required>
          <Input
            kind="select"
            id="compliance-profile-select"
            name="compliance-profile-select"
            value={selected}
            onChange={setSelected}
            options={profileOptions}
            required
          />
        </Field>
        {actionError !== null && <Banner variant="error">{actionError}</Banner>}
      </Form>

      <Card slots={{ title: t("compliance.profile.catalog") }}>
        <ul className="flex flex-col gap-2 text-sm">
          {state.profiles.map((profile) => (
            <li key={profile.key} data-profile-key={profile.key}>
              <strong>{profile.label}</strong> — {profile.region} — {profile.authorityContact}
            </li>
          ))}
        </ul>
      </Card>
    </FormScreenShell>
  );
}
