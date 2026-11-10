import { TemplateResolverQueries } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import {
  dispatcherErrorText,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { pluralKey } from "@cosmicdrift/kumiko-renderer/headless";
import { type ReactNode, useState } from "react";
import { ApplyLayoutDialog } from "./apply-layout-dialog.tsx";
import { RailHint, RailSection } from "./rail.tsx";
import { statusLabel } from "./status-label.ts";
import { DOCUMENT_PDF_KIND } from "./types.ts";
import { type TemplateOutcome, templateOutcomeText, useApplyLayout } from "./use-apply-layout.ts";
import { useOverviewRows } from "./use-overview-rows.ts";
import { templateTitle, templateTitleText } from "./used-by-label.ts";

const PDF_LAYOUT_KIND = "pdf-layout";

type LayoutUser = {
  readonly slug: string;
  readonly locale: string;
  readonly title: string;
  readonly status: "draft" | "active";
  readonly version: number;
};

function groupByTemplate(users: readonly LayoutUser[]): readonly {
  readonly slug: string;
  readonly first: LayoutUser;
  readonly draft: LayoutUser | undefined;
  readonly draftLocales: readonly string[];
}[] {
  const bySlug = new Map<string, LayoutUser[]>();
  for (const user of users) bySlug.set(user.slug, [...(bySlug.get(user.slug) ?? []), user]);
  return [...bySlug.entries()].flatMap(([slug, group]) => {
    const [first] = group;
    return first === undefined
      ? []
      : [
          {
            slug,
            first,
            draft: group.find((user) => user.status === "draft"),
            draftLocales: group
              .filter((user) => user.status === "draft")
              .map((user) => user.locale),
          },
        ];
  });
}

export function LayoutUsageSection({ slug }: { readonly slug: string }): ReactNode {
  const t = useTranslation();
  const { Button, Banner } = usePrimitives();
  const { publish } = useApplyLayout();
  const layoutRow = useOverviewRows(PDF_LAYOUT_KIND).rows.find((row) => row.slug === slug);
  const layoutTitle = layoutRow === undefined ? slug : templateTitle(t, layoutRow);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState<readonly TemplateOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);
  const usage = useQuery<{ readonly usedByTemplates?: readonly LayoutUser[] }>(
    TemplateResolverQueries.usage,
    { slug, kind: PDF_LAYOUT_KIND },
  );
  const users = usage.data?.usedByTemplates ?? [];
  const drafts = users.filter((user) => user.status === "draft");

  const publishDrafts = async (): Promise<void> => {
    setError(null);
    const result = await publish.mutate({
      templates: drafts.map(({ slug: draftSlug, locale }) => ({
        slug: draftSlug,
        locale,
        kind: DOCUMENT_PDF_KIND,
      })),
    });
    if (!result.isSuccess) {
      setError(dispatcherErrorText(result.error, t));
      return;
    }
    setFailed(result.data.failed);
    void usage.refetch();
  };

  return (
    <RailSection title={t("documentDesigner.usedBy.title")} testId="layout-usage-section">
      {users.length === 0 && <RailHint>{t("documentDesigner.usedBy.none")}</RailHint>}
      {groupByTemplate(users).map(({ slug: groupSlug, first, draft, draftLocales }) => (
        <div
          key={groupSlug}
          data-testid={`layout-usage-${groupSlug}`}
          className="flex min-h-10 items-center justify-between gap-2 border-b px-3.5"
        >
          <span className="min-w-0 wrap-anywhere text-sm">
            {draftLocales.length >= 2
              ? `${templateTitleText(t, first.title)} (${draftLocales.join(", ")})`
              : templateTitleText(t, first.title)}
          </span>
          <span className="shrink-0 text-right text-xs text-muted-foreground">
            {draft === undefined
              ? statusLabel(t, first.status, first.version)
              : t("documentDesigner.status.draft")}
          </span>
        </div>
      ))}
      <div className="flex flex-col gap-2 px-3.5 py-2">
        {error !== null && <Banner variant="error">{error}</Banner>}
        {failed.length > 0 && (
          <Banner variant="error">
            <strong>{t("documentDesigner.applyLayout.failed")}</strong>
            <ul className="list-disc pl-5">
              {failed.map((item) => (
                <li key={`${item.slug}:${item.locale}`}>{templateOutcomeText(t, item)}</li>
              ))}
            </ul>
          </Banner>
        )}
        {drafts.length > 0 && <RailHint>{t("documentDesigner.usedBy.publishHint")}</RailHint>}
        {drafts.length > 0 && (
          <Button
            size="sm"
            disabled={publish.pending}
            loading={publish.pending}
            onClick={publishDrafts}
            testId="layout-usage-publish"
          >
            {t(pluralKey("documentDesigner.applyLayout.publish", drafts.length), {
              count: drafts.length,
            })}
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setOpen(true)}
          testId="layout-apply-open"
        >
          {t("documentDesigner.applyLayout.open")}
        </Button>
      </div>
      {open && (
        <ApplyLayoutDialog
          layoutSlug={slug}
          layoutTitle={layoutTitle}
          onOpenChange={setOpen}
          onApplied={() => {
            void usage.refetch();
          }}
        />
      )}
    </RailSection>
  );
}
