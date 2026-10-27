// Extension-section component for the profile-picker actionForm's catalog
// block — read-only list of the selectable compliance profiles (region +
// supervisory authority). The select field above owns the actual choice;
// this is reference material for the tenant admin.
import {
  type ExtensionSectionProps,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { ComplianceProfileQueries } from "./constants.ts";

type ProfileSummary = {
  readonly key: string;
  readonly region: string;
  readonly label: string;
  readonly authorityContact: string;
};

type ListProfilesResponse = {
  readonly profiles: readonly ProfileSummary[];
};

// The select options above carry locale translations; the catalog reuses them so both
// name a profile alike. A profile without an option key keeps its source label.
function profileLabel(profile: ProfileSummary, t: (key: string) => string): string {
  const optionKey = `compliance-profiles:entity:__action-form__:field:profileKey:option:${profile.key}`;
  const translated = t(optionKey);
  return translated === optionKey ? profile.label : translated;
}

export function ComplianceProfileCatalog(_props: ExtensionSectionProps): ReactNode {
  const { Banner, Text } = usePrimitives();
  const t = useTranslation();
  const query = useQuery<ListProfilesResponse>(ComplianceProfileQueries.listProfiles, {});

  if (query.loading && query.data === null) {
    return (
      <Banner variant="loading" testId="compliance-profile-catalog-loading">
        <Text>{t("compliance.profile.catalog.loading")}</Text>
      </Banner>
    );
  }
  if (query.error) {
    return (
      <Banner variant="error" testId="compliance-profile-catalog-error">
        <Text>{t(query.error.i18nKey, query.error.i18nParams)}</Text>
      </Banner>
    );
  }

  return (
    <ul className="flex flex-col gap-2 text-sm" data-testid="compliance-profile-catalog">
      {(query.data?.profiles ?? []).map((profile) => (
        <li key={profile.key} data-profile-key={profile.key}>
          <strong>{profileLabel(profile, t)}</strong> — {profile.region} —{" "}
          {profile.authorityContact}
        </li>
      ))}
    </ul>
  );
}
