import { TemplateResolverQueries } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import {
  type ColumnRendererComponent,
  type ColumnRendererProps,
  formatWhen,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { EMPTY_VALUE_PLACEHOLDER, toInstant } from "@cosmicdrift/kumiko-renderer/headless";
import { StatusBadge } from "@cosmicdrift/kumiko-renderer/web";
import type { ReactNode } from "react";
import { type OverviewRowView, parseOverviewRow } from "./overview-row.ts";
import { statusLabel, statusTone } from "./status-label.ts";
import { templateTitle, usedByLabel } from "./used-by-label.ts";

function withRow(
  row: Readonly<Record<string, unknown>>,
  render: (r: OverviewRowView) => ReactNode,
) {
  const parsed = parseOverviewRow(row);
  return parsed === null ? EMPTY_VALUE_PLACEHOLDER : render(parsed);
}

export function TitleCell({ row }: ColumnRendererProps): ReactNode {
  const t = useTranslation();
  return withRow(row, (r) => (
    <div>
      {/* Titles wrap and slugs are capped, so long notification names keep status, usage and date in view. */}
      <div className="max-w-48 whitespace-normal font-medium">{templateTitle(t, r)}</div>
      <span
        className="block max-w-40 truncate font-mono text-xs text-muted-foreground"
        title={r.slug}
      >
        {r.slug}
      </span>
    </div>
  ));
}

const KIND_KEY: Readonly<Record<OverviewRowView["kind"], string>> = {
  mail: "documentDesigner.kind.mail",
  "document-pdf": "documentDesigner.kind.pdf",
  "mail-layout": "documentDesigner.kind.layout",
  "pdf-layout": "documentDesigner.kind.layout",
};

export function KindCell({ row }: ColumnRendererProps): ReactNode {
  const t = useTranslation();
  return withRow(row, (r) => t(KIND_KEY[r.kind]));
}

export function OriginCell({ row }: ColumnRendererProps): ReactNode {
  const t = useTranslation();
  return withRow(row, (r) => (
    <StatusBadge
      tone={r.origin === "tenant" ? "accent" : "muted"}
      testId="document-designer-origin"
    >
      {t(
        r.origin === "tenant" ? "documentDesigner.source.tenant" : "documentDesigner.source.system",
      )}
    </StatusBadge>
  ));
}

export function createLocalesCell(appLocales: readonly string[]): ColumnRendererComponent {
  return function LocalesCell({ row }: ColumnRendererProps): ReactNode {
    return withRow(row, (r) => {
      if (r.kind === "mail-layout" || r.kind === "pdf-layout") return EMPTY_VALUE_PLACEHOLDER;
      const present = new Set(r.locales);
      const shown = [...appLocales, ...r.locales.filter((l) => !appLocales.includes(l))];
      return (
        <span className="inline-flex gap-1">
          {shown.map((locale) => (
            <span
              key={locale}
              data-testid={`document-designer-locale-${locale}`}
              data-present={present.has(locale)}
              className={
                present.has(locale)
                  ? "rounded border border-transparent bg-muted px-1.5 text-xs font-medium uppercase"
                  : "rounded border border-dashed px-1.5 text-xs uppercase text-muted-foreground"
              }
            >
              {locale}
            </span>
          ))}
        </span>
      );
    });
  };
}

export function StatusCell({ row }: ColumnRendererProps): ReactNode {
  const t = useTranslation();
  return withRow(row, (r) => (
    <span className="flex flex-col items-start gap-1">
      <StatusBadge tone={statusTone(r.status)} testId="document-designer-status">
        {statusLabel(t, r.status, r.version)}
      </StatusBadge>
      {r.lockedOverride && r.lockedOverrideI18nKey !== null && (
        <span title={t(r.lockedOverrideI18nKey)}>
          <StatusBadge tone="warn" testId="document-designer-locked-override">
            {t("documentDesigner.status.lockedOverride")}
          </StatusBadge>
        </span>
      )}
      {r.status === "active" && r.draftVersion !== null && (
        <StatusBadge tone={statusTone("draft")} testId="document-designer-draft-status">
          {statusLabel(t, "draft", r.draftVersion)}
        </StatusBadge>
      )}
    </span>
  ));
}

export function UsedByCell({ row }: ColumnRendererProps): ReactNode {
  const t = useTranslation();
  return withRow(row, (r) => {
    const label = usedByLabel(t, r);
    return (
      <span className="block max-w-28 truncate" title={label}>
        {label}
      </span>
    );
  });
}

// Date only keeps the column narrow enough for the overview to fit without
// horizontal scroll; the full timestamp stays reachable via the tooltip.
function formatModifiedDate(value: string): string {
  try {
    return toInstant(value).toLocaleString(undefined, { dateStyle: "medium" });
  } catch {
    return value;
  }
}

export function ModifiedCell({ row }: ColumnRendererProps): ReactNode {
  return withRow(row, (r) =>
    r.modifiedAt === "" ? (
      EMPTY_VALUE_PLACEHOLDER
    ) : (
      <span className="whitespace-nowrap" title={formatWhen(r.modifiedAt)}>
        {formatModifiedDate(r.modifiedAt)}
      </span>
    ),
  );
}

type TenantOverrides = {
  readonly activeOverrides: number;
  readonly draftOverrides: number;
  readonly totalTenants: number | null;
};

function OverriddenByCount({
  slug,
  kind,
}: {
  readonly slug: string;
  readonly kind: string;
}): ReactNode {
  const t = useTranslation();
  const { data } = useQuery<TenantOverrides>(TemplateResolverQueries.tenantOverrides, {
    slug,
    kind,
  });
  if (data === null) return EMPTY_VALUE_PLACEHOLDER;
  const label =
    data.totalTenants === null
      ? t("documentDesigner.overriddenBy.tenants", { active: data.activeOverrides })
      : t("documentDesigner.overriddenBy.ofTotal", {
          active: data.activeOverrides,
          total: data.totalTenants,
        });
  return <span>{label}</span>;
}

export function OverriddenByCell({ row }: ColumnRendererProps): ReactNode {
  return withRow(row, (r) =>
    r.origin === "system" ? (
      <OverriddenByCount slug={r.slug} kind={r.kind} />
    ) : (
      EMPTY_VALUE_PLACEHOLDER
    ),
  );
}
