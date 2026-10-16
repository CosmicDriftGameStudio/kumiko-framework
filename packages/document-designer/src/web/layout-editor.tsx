// @runtime client
import { TemplateResolverQueries } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { useNav, useQuery, useUserRoles } from "@cosmicdrift/kumiko-renderer";
import { LoadingState } from "@cosmicdrift/kumiko-renderer-web";
import { type ReactNode, useState } from "react";
import {
  DEFAULT_LAYOUT_SLUG,
  PLATFORM_TEMPLATES_SCREEN_ID,
  TEMPLATES_SCREEN_ID,
} from "../constants.js";
import { LayoutEditorBody } from "./layout-editor-body.js";
import { parseOverviewRow } from "./overview-row.js";
import type { LayoutKind, LayoutSourceView, TenantOverrideCounts } from "./layout-types.js";

function parseLayoutKind(raw: string | undefined): LayoutKind {
  return raw === "pdf-layout" ? "pdf-layout" : "mail-layout";
}

type OverviewResponse = { readonly rows: readonly Readonly<Record<string, unknown>>[] };

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
  const nav = useNav();
  const source = useQuery<LayoutSourceView>(TemplateResolverQueries.layoutSource, { kind, slug });
  const overview = useQuery<OverviewResponse>(TemplateResolverQueries.overview, { limit: 200 });
  const overrides = useQuery<TenantOverrideCounts>(
    TemplateResolverQueries.tenantOverrides,
    { slug, kind },
    { enabled: isSystemAdmin },
  );

  if (source.data === null) {
    return <LoadingState />;
  }
  const data = source.data;
  const rows = (overview.data?.rows ?? []).flatMap((row) => parseOverviewRow(row) ?? []);
  const reload = async (): Promise<void> => {
    await Promise.all([source.refetch(), overview.refetch(), overrides.refetch()]);
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
      overrides={isSystemAdmin ? overrides.data : null}
      onKindChange={onKindChange}
      onReload={reload}
      onBack={() =>
        nav.navigate({
          screenId: isSystemAdmin ? PLATFORM_TEMPLATES_SCREEN_ID : TEMPLATES_SCREEN_ID,
        })
      }
    />
  );
}

export function LayoutEditor(): ReactNode {
  const nav = useNav();
  const roles = useUserRoles();
  const [kind, setKind] = useState<LayoutKind>(() => parseLayoutKind(nav.searchParams["kind"]));
  const slug = nav.searchParams["slug"] ?? DEFAULT_LAYOUT_SLUG;
  return (
    <LayoutEditorLoader
      key={kind}
      kind={kind}
      slug={slug}
      isSystemAdmin={roles?.includes("SystemAdmin") === true}
      onKindChange={setKind}
    />
  );
}
