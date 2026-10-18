// @runtime client
import { TemplateResolverQueries } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import type { ListColumnViewModel, ListRowViewModel } from "@cosmicdrift/kumiko-headless";
import { formatWhen, usePrimitives, useQuery, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { Drawer, EmptyState, LoadingState } from "@cosmicdrift/kumiko-renderer-web";
import { type ReactNode, useMemo, useState } from "react";
import { DiffView } from "./origin-bar.tsx";
import {
  DOCUMENT_PDF_KIND,
  type TemplateUsage,
  type TenantOverrideRow,
  type TenantOverrides,
} from "./types.ts";

export type OverridesDrawerProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly slug: string;
  readonly locale: string;
  readonly overrides: TenantOverrides | null;
};

type DetailView = { readonly row: TenantOverrideRow; readonly mode: "diff" | "full" };

const DRAWER_WIDTH = 960;

function TenantDetail({
  slug,
  locale,
  view,
  onBack,
}: {
  readonly slug: string;
  readonly locale: string;
  readonly view: DetailView;
  readonly onBack: () => void;
}): ReactNode {
  const t = useTranslation();
  const { Button } = usePrimitives();
  const detail = useQuery<TenantOverrides>(TemplateResolverQueries.tenantOverrides, {
    slug,
    kind: DOCUMENT_PDF_KIND,
    locale,
    diffTenantId: view.row.tenantId,
  });
  return (
    <div className="flex flex-col gap-3" data-testid="document-designer-overrides-detail">
      <div className="flex items-center justify-between gap-3">
        <h3 className="m-0 text-sm font-semibold">
          {t("documentDesigner.overrides.detail.version", {
            tenant: view.row.tenantName,
            version: view.row.version,
          })}
        </h3>
        <Button variant="link" onClick={onBack} testId="document-designer-overrides-back">
          {t("documentDesigner.overrides.back")}
        </Button>
      </div>
      {detail.data?.diff == null ? (
        <LoadingState />
      ) : (
        <DiffView data={detail.data.diff} mode={view.mode} />
      )}
    </div>
  );
}

export function OverridesDrawer({
  open,
  onOpenChange,
  slug,
  locale,
  overrides,
}: OverridesDrawerProps): ReactNode {
  const t = useTranslation();
  const { DataTable } = usePrimitives();
  const [view, setView] = useState<DetailView | null>(null);
  // Only asked while the drawer is open; the answer is not needed for the editor itself.
  const usage = useQuery<TemplateUsage>(
    TemplateResolverQueries.usage,
    { slug, kind: DOCUMENT_PDF_KIND },
    { enabled: open },
  );
  const usedBy = usage.data?.usedBy ?? [];
  const tenantRows = overrides?.rows ?? [];

  const columns = useMemo<readonly ListColumnViewModel[]>(
    () => [
      {
        field: "tenantName",
        label: t("documentDesigner.overrides.column.tenant"),
        type: "text",
        sortable: false,
      },
      {
        field: "status",
        label: t("documentDesigner.overrides.column.status"),
        type: "select",
        sortable: false,
        optionLabels: {
          active: t("documentDesigner.overrides.status.active"),
          draft: t("documentDesigner.overrides.status.draft"),
        },
        optionTones: { active: "ok", draft: "warn" },
      },
      {
        field: "versionLabel",
        label: t("documentDesigner.overrides.column.version"),
        type: "text",
        sortable: false,
      },
      {
        field: "changed",
        label: t("documentDesigner.overrides.column.changed"),
        type: "text",
        sortable: false,
      },
    ],
    [t],
  );
  const rows = useMemo<readonly ListRowViewModel[]>(
    () =>
      tenantRows.map((row) => ({
        id: row.tenantId,
        values: {
          tenantName: row.tenantName,
          status: row.status,
          versionLabel: `v${row.version}`,
          changed: formatWhen(row.changedAt),
        },
      })),
    [tenantRows],
  );
  const openRow = (row: ListRowViewModel, mode: DetailView["mode"]): void => {
    const found = tenantRows.find((candidate) => candidate.tenantId === row.id);
    if (found !== undefined) setView({ row: found, mode });
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) setView(null);
        onOpenChange(next);
      }}
      title={t("documentDesigner.overrides.title")}
      width={DRAWER_WIDTH}
      testId="document-designer-overrides-drawer"
    >
      <div className="flex flex-col gap-5">
        {view !== null ? (
          <TenantDetail slug={slug} locale={locale} view={view} onBack={() => setView(null)} />
        ) : (
          <>
            {tenantRows.length > 0 && (
              <p className="m-0 text-sm text-muted-foreground" data-testid="overrides-summary">
                {t("documentDesigner.overrides.summary", { count: tenantRows.length })}
              </p>
            )}
            {tenantRows.length === 0 ? (
              <EmptyState title={t("documentDesigner.overrides.empty")} />
            ) : (
              <DataTable
                columns={columns}
                rows={rows}
                rowActionMode="inline"
                rowActions={[
                  {
                    id: "diff",
                    label: t("documentDesigner.overrides.action.diff"),
                    style: "secondary",
                    onTrigger: (row) => openRow(row, "diff"),
                  },
                  {
                    id: "open",
                    label: t("documentDesigner.overrides.action.open"),
                    style: "secondary",
                    onTrigger: (row) => openRow(row, "full"),
                  },
                ]}
                testId="document-designer-overrides-table"
              />
            )}
            <section className="flex flex-col gap-2">
              <h3 className="m-0 text-sm font-semibold">
                {t("documentDesigner.overrides.usedBy")}
              </h3>
              {usedBy.length === 0 ? (
                <p className="m-0 text-sm text-muted-foreground">
                  {t("documentDesigner.overrides.usedByEmpty")}
                </p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-1 p-0 font-mono text-xs">
                  {usedBy.map((entry) => (
                    <li key={`${entry.qualifiedName}:${entry.role}`}>{entry.qualifiedName}</li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </Drawer>
  );
}
