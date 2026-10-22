import { TemplateResolverQueries } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { useNav, useQuery, useUserRoles } from "@cosmicdrift/kumiko-renderer";
import { ErrorState, LoadingState } from "@cosmicdrift/kumiko-renderer/web";
import { type ReactNode, useState } from "react";
import { DEFAULT_LAYOUT_SLUG } from "./constants.ts";
import { LayoutEditorBody } from "./layout-editor-body.tsx";
import type { LayoutKind, LayoutSourceView, TenantOverrideCounts } from "./layout-types.ts";
import { layoutUserKind } from "./layout-users.ts";
import { parseOverviewRow } from "./overview-row.ts";

function parseLayoutKind(raw: string | undefined): LayoutKind {
  return raw === "pdf-layout" ? "pdf-layout" : "mail-layout";
}

type OverviewResponse = {
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly total: number;
};

function LayoutEditorLoader({
  kind,
  slug,
  isSystemAdmin,
  onKindChange,
}: {
  readonly kind: LayoutKind;
  readonly slug: string;
  readonly isSystemAdmin: boolean;
  readonly onKindChange: (kind: LayoutKind) => void;
}): ReactNode {
  const source = useQuery<LayoutSourceView>(TemplateResolverQueries.layoutSource, {
    kind,
    slug,
    scope: isSystemAdmin ? "system" : "tenant",
  });
  const overview = useQuery<OverviewResponse>(TemplateResolverQueries.overview, {
    limit: 200,
    layoutSlug: slug,
    filters: [{ field: "kind", op: "in", value: [layoutUserKind(kind)] }],
  });
  const overrides = useQuery<TenantOverrideCounts>(
    TemplateResolverQueries.tenantOverrides,
    { slug, kind },
    { enabled: isSystemAdmin },
  );

  if (source.error !== null) {
    return (
      <ErrorState
        error={source.error}
        onRetry={() => void source.refetch()}
        testId="document-designer-layout-error"
      />
    );
  }
  if (source.data === null) {
    return <LoadingState />;
  }
  const data = source.data;
  const rows = (overview.data?.rows ?? []).flatMap((row) => parseOverviewRow(row) ?? []);
  const reload = async (): Promise<void> => {
    // refetch ignores `enabled`, and tenant-overrides is denied to everyone but the platform admin.
    await Promise.all([
      source.refetch(),
      overview.refetch(),
      ...(isSystemAdmin ? [overrides.refetch()] : []),
    ]);
  };
  // A saved or reset layout is a new version: remount so the editors take the stored regions.
  const bodyKey = [kind, slug, data.tenant?.id, data.tenant?.version, data.system?.version].join(
    "|",
  );
  return (
    <LayoutEditorBody
      key={bodyKey}
      kind={kind}
      slug={slug}
      isSystemAdmin={isSystemAdmin}
      source={data}
      overviewRows={rows}
      usedByCount={overview.data?.total ?? rows.length}
      overrides={isSystemAdmin ? overrides.data : null}
      onKindChange={onKindChange}
      onReload={reload}
    />
  );
}

export function LayoutEditor({
  scope = "tenant",
}: {
  readonly scope?: "tenant" | "system";
}): ReactNode {
  const nav = useNav();
  const roles = useUserRoles();
  const [kind, setKind] = useState<LayoutKind>(() => parseLayoutKind(nav.searchParams["kind"]));
  const slug = nav.searchParams["slug"] ?? DEFAULT_LAYOUT_SLUG;
  return (
    <LayoutEditorLoader
      key={kind}
      kind={kind}
      slug={slug}
      isSystemAdmin={scope === "system" && roles?.includes("SystemAdmin") === true}
      onKindChange={setKind}
    />
  );
}
