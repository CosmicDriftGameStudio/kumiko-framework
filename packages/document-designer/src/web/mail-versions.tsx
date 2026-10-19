// @runtime client
import { formatWhen, useAppFeatures, useQuery, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { EMPTY_VALUE_PLACEHOLDER } from "@cosmicdrift/kumiko-renderer/headless";
import { StatusBadge } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";
import { RailHint, RailRow, RailSection } from "./rail.tsx";
import { asRowStatus, statusLabel, statusTone } from "./status-label.ts";

const AUDIT_FEATURE = "audit";
const AUDIT_LIST_QUERY = "audit:query:list";
const MEMBER_DIRECTORY_QUERY = "tenant:query:member-directory";
const VERSION_LIMIT = 20;

type AuditRow = {
  readonly version: number;
  readonly createdAt: string;
  readonly createdBy: string;
};
type AuditResponse = { readonly rows: readonly AuditRow[] };
type MemberDirectory = {
  readonly rows: readonly { readonly id: string; readonly label: string }[];
};

function VersionRows({
  rowId,
  currentVersion,
  currentStatus,
}: {
  readonly rowId: string;
  readonly currentVersion: number;
  readonly currentStatus: string;
}): ReactNode {
  const t = useTranslation();
  const audit = useQuery<AuditResponse>(AUDIT_LIST_QUERY, {
    aggregateType: "template-resource",
    aggregateId: rowId,
    limit: VERSION_LIMIT,
  });
  const members = useQuery<MemberDirectory>(MEMBER_DIRECTORY_QUERY, { limit: 200 });
  const names = new Map((members.data?.rows ?? []).map((member) => [member.id, member.label]));
  const status = asRowStatus(currentStatus);
  // The event log has one entry per change; show each version once, newest first.
  const seen = new Set<number>();
  const versions = (audit.data?.rows ?? []).filter((row) => {
    if (seen.has(row.version)) return false;
    seen.add(row.version);
    return true;
  });
  return (
    <>
      {versions.map((row) => (
        <RailRow
          key={row.version}
          testId={`mail-version-${row.version}`}
          label={t("documentDesigner.mail.versions.line", {
            version: row.version,
            when: formatWhen(row.createdAt),
            name: names.get(row.createdBy) ?? EMPTY_VALUE_PLACEHOLDER,
          })}
          trailing={
            row.version === currentVersion ? (
              <StatusBadge tone={statusTone(status)}>
                {statusLabel(t, status, row.version)}
              </StatusBadge>
            ) : undefined
          }
        />
      ))}
    </>
  );
}

// Hidden when the audit feature is not mounted, so no failing query shows up as an error.
export function VersionsSection({
  rowId,
  currentVersion,
  currentStatus,
}: {
  readonly rowId: string | null;
  readonly currentVersion: number;
  readonly currentStatus: string;
}): ReactNode {
  const t = useTranslation();
  const features = useAppFeatures();
  if (rowId === null || !features.some((feature) => feature.featureName === AUDIT_FEATURE)) {
    return null;
  }
  return (
    <RailSection title={t("documentDesigner.mail.versions.title")} testId="mail-editor-versions">
      <VersionRows rowId={rowId} currentVersion={currentVersion} currentStatus={currentStatus} />
      <RailHint>{t("documentDesigner.mail.versions.hint")}</RailHint>
    </RailSection>
  );
}
