// @runtime client
import { TemplateResolverQueries } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { useQuery, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { Drawer } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";
import { DOCUMENT_PDF_KIND, type TemplateUsage, type TenantOverrides } from "./types.js";

export type OverridesDrawerProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly slug: string;
  readonly overrides: TenantOverrides | null;
};

function BreakdownRow({ label, value }: { label: string; value: number }): ReactNode {
  return (
    <li className="flex items-center justify-between gap-4 text-sm">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </li>
  );
}

export function OverridesDrawer({
  open,
  onOpenChange,
  slug,
  overrides,
}: OverridesDrawerProps): ReactNode {
  const t = useTranslation();
  // Only asked while the drawer is open; the answer is not needed for the editor itself.
  const usage = useQuery<TemplateUsage>(
    TemplateResolverQueries.usage,
    { slug, kind: DOCUMENT_PDF_KIND },
    { enabled: open },
  );
  const active = overrides?.activeOverrides ?? 0;
  const draft = overrides?.draftOverrides ?? 0;
  const total = overrides?.totalTenants ?? null;
  const usedBy = usage.data?.usedBy ?? [];

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={t("documentDesigner.overrides.title")}
      testId="document-designer-overrides-drawer"
    >
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            <BreakdownRow label={t("documentDesigner.overrides.active")} value={active} />
            <BreakdownRow label={t("documentDesigner.overrides.draftOnly")} value={draft} />
            {total !== null && (
              <BreakdownRow
                label={t("documentDesigner.overrides.none")}
                value={Math.max(0, total - active - draft)}
              />
            )}
            {total !== null && (
              <BreakdownRow label={t("documentDesigner.overrides.total")} value={total} />
            )}
          </ul>
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-sm font-semibold">{t("documentDesigner.overrides.usedBy")}</h3>
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
      </div>
    </Drawer>
  );
}
