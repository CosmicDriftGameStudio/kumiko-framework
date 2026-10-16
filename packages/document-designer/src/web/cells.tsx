// @runtime client

import { TemplateResolverQueries } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { toInstant } from "@cosmicdrift/kumiko-headless";
import {
  type ColumnRendererComponent,
  type ColumnRendererProps,
  formatWhen,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { StatusBadge } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";
import { type OverviewRowView, parseOverviewRow } from "./overview-row.js";
import { statusLabel, statusTone } from "./status-label.js";
import { usedByLabel } from "./used-by-label.js";

const EMPTY_MARK = "–";

function withRow(
  row: Readonly<Record<string, unknown>>,
  render: (r: OverviewRowView) => ReactNode,
) {
  const parsed = parseOverviewRow(row);
  return parsed === null ? EMPTY_MARK : render(parsed);
}

export function TitleCell({ row }: ColumnRendererProps): ReactNode {
  return withRow(row, (r) => (
    <div>
      <div className="font-medium">{r.title}</div>
      {/* Qualified notification slugs are long; capped so status, usage and date stay in view. */}
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
      if (r.kind === "mail-layout" || r.kind === "pdf-layout") return EMPTY_MARK;
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
    <StatusBadge tone={statusTone(r.status)} testId="document-designer-status">
      {statusLabel(t, r.status, r.version)}
    </StatusBadge>
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
      EMPTY_MARK
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
  if (data === null) return EMPTY_MARK;
  const label =
    data.totalTenants === null
      ? t("documentDesigner.overriddenBy.tenants", { active: data.activeOverrides })
      : t("documentDesigner.overriddenBy.ofTotal", {
          active: data.activeOverrides,
          total: data.totalTenants,
        });
  return <span className="whitespace-nowrap">{label}</span>;
}

export function OverriddenByCell({ row }: ColumnRendererProps): ReactNode {
  return withRow(row, (r) =>
    r.origin === "system" ? <OverriddenByCount slug={r.slug} kind={r.kind} /> : EMPTY_MARK,
  );
}
