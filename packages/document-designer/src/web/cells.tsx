// @runtime client

import { TemplateResolverQueries } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
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

export function SlugCell({ row }: ColumnRendererProps): ReactNode {
  return withRow(row, (r) => (
    <span className="font-mono text-xs text-muted-foreground">{r.slug}</span>
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
  return withRow(row, (r) => usedByLabel(t, r));
}

export function ModifiedCell({ row }: ColumnRendererProps): ReactNode {
  return withRow(row, (r) => (r.modifiedAt === "" ? EMPTY_MARK : formatWhen(r.modifiedAt)));
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
  return data.totalTenants === null
    ? t("documentDesigner.overriddenBy.tenants", { active: data.activeOverrides })
    : t("documentDesigner.overriddenBy.ofTotal", {
        active: data.activeOverrides,
        total: data.totalTenants,
      });
}

export function OverriddenByCell({ row }: ColumnRendererProps): ReactNode {
  return withRow(row, (r) =>
    r.origin === "system" ? <OverriddenByCount slug={r.slug} kind={r.kind} /> : EMPTY_MARK,
  );
}
