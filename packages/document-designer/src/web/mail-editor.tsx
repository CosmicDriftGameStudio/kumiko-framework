import { TemplateResolverQueries } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import {
  useLocale,
  useNav,
  useQuery,
  useTranslation,
  useUserRoles,
} from "@cosmicdrift/kumiko-renderer";
import { LoadingState } from "@cosmicdrift/kumiko-renderer/web";
import { type ComponentType, type ReactNode, useState } from "react";
import { DEFAULT_TEMPLATE_LOCALES } from "./constants.ts";
import { defaultLocaleOf } from "./editor-locale.ts";
import { MailEditorBody } from "./mail-editor-body.tsx";
import type { TemplateRowSummary, TemplateRowView } from "./mail-types.ts";
import type { OverviewRowView } from "./overview-row.ts";
import { useOverviewRows } from "./use-overview-rows.ts";
import { templateTitle } from "./used-by-label.ts";

function fallbackLocaleOf(locale: string, rowLocales: readonly string[]): string | null {
  const others = rowLocales.filter((candidate) => candidate !== locale);
  const preferred = DEFAULT_TEMPLATE_LOCALES[0];
  return (preferred !== undefined && others.includes(preferred) ? preferred : others[0]) ?? null;
}

function shownSummaryOf(
  summaries: readonly TemplateRowSummary[],
  slug: string,
  isSystemAdmin: boolean,
): TemplateRowSummary | null {
  const ofSlug = summaries.filter((summary) => summary.slug === slug);
  const tenant = ofSlug.find((summary) => summary.scope === "tenant");
  const system = ofSlug.find((summary) => summary.scope === "system");
  return (isSystemAdmin ? system : (tenant ?? system)) ?? null;
}

function MailEditorData({
  slug,
  locale,
  locales,
  overviewRow,
  isSystemAdmin,
  onLocaleChange,
  refreshOverview,
}: {
  readonly slug: string;
  readonly locale: string;
  readonly locales: readonly string[];
  readonly overviewRow: OverviewRowView | null;
  readonly isSystemAdmin: boolean;
  readonly onLocaleChange: (locale: string) => void;
  readonly refreshOverview: () => Promise<void>;
}): ReactNode {
  const t = useTranslation();
  const [generation, setGeneration] = useState(0);
  const list = useQuery<readonly TemplateRowSummary[]>(TemplateResolverQueries.list, {
    kind: "mail",
    locale,
    includeSystem: true,
  });
  const shown = shownSummaryOf(list.data ?? [], slug, isSystemAdmin);
  const stored = useQuery<TemplateRowView | null>(
    TemplateResolverQueries.findById,
    { id: shown?.id ?? "" },
    { enabled: shown !== null },
  );
  const row = stored.data !== null && stored.data.id === shown?.id ? stored.data : null;
  // A changed row id keeps the previous row in `stored` until the new one arrives.
  if (list.data === null || (shown !== null && row === null)) return <LoadingState />;

  const reload = async (): Promise<void> => {
    await Promise.all([list.refetch(), refreshOverview()]);
    await stored.refetch();
    setGeneration((current) => current + 1);
  };
  const rowLocales = overviewRow?.locales ?? [];
  return (
    <MailEditorBody
      key={`${locale}|${generation}|${row?.id ?? "none"}`}
      slug={slug}
      locale={locale}
      locales={locales}
      title={overviewRow === null ? slug : templateTitle(t, overviewRow)}
      isSystemAdmin={isSystemAdmin}
      row={row}
      systemVersion={overviewRow?.systemVersion ?? null}
      fallbackLocale={fallbackLocaleOf(locale, rowLocales)}
      onLocaleChange={onLocaleChange}
      onReload={reload}
      onRefreshRow={async () => {
        await stored.refetch();
      }}
    />
  );
}

function MailEditorEntry({ appLocales }: { readonly appLocales: readonly string[] }): ReactNode {
  const nav = useNav();
  const roles = useUserRoles();
  const uiLocale = useLocale().locale();
  const slug = nav.searchParams["slug"] ?? "";
  const overview = useOverviewRows("mail", slug);
  const [picked, setPicked] = useState<string | null>(nav.searchParams["locale"] ?? null);
  if (!overview.loaded) return <LoadingState />;
  const overviewRow = overview.rows.find((candidate) => candidate.slug === slug) ?? null;
  const rowLocales = overviewRow?.locales ?? [];
  const locale = picked ?? defaultLocaleOf(uiLocale, appLocales, rowLocales);
  const locales = [...new Set([...appLocales, ...rowLocales])];
  return (
    <MailEditorData
      key={locale}
      slug={slug}
      locale={locale}
      locales={locales}
      overviewRow={overviewRow}
      isSystemAdmin={roles?.includes("SystemAdmin") === true}
      onLocaleChange={setPicked}
      refreshOverview={overview.refetch}
    />
  );
}

export function createMailEditor(appLocales: readonly string[]): ComponentType {
  return function MailEditor(): ReactNode {
    return <MailEditorEntry appLocales={appLocales} />;
  };
}
