// @runtime client
import {
  TemplateResolverHandlers,
  TemplateResolverQueries,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { EMPTY_VALUE_PLACEHOLDER } from "@cosmicdrift/kumiko-headless";
import {
  dispatcherErrorText,
  useMutation,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { EmptyState, ErrorState, LoadingState } from "@cosmicdrift/kumiko-renderer-web";
import { type ReactNode, useState } from "react";
import { originOf } from "./editor-header.tsx";
import { EditorInfoBar } from "./editor-shell.tsx";
import type {
  LayoutKind,
  LayoutSourceView,
  TemplateDiff,
  TenantOverrideCounts,
} from "./layout-types.ts";
import { draftBesideActiveSentence } from "./status-label.ts";

const DIFF_MARK: Readonly<Record<TemplateDiff["blocks"][number]["change"], string>> = {
  same: " ",
  added: "+",
  removed: "-",
};

const DIFF_TONE: Readonly<Record<TemplateDiff["blocks"][number]["change"], string>> = {
  same: "text-muted-foreground",
  added: "bg-status-ok-surface text-status-ok",
  removed: "bg-status-bad-surface text-status-bad",
};

function metaValueText(value: unknown): string {
  if (value === undefined || value === null) return EMPTY_VALUE_PLACEHOLDER;
  return typeof value === "string" ? value : JSON.stringify(value);
}

// "full" shows the tenant's version as it reads (everything but the removed system blocks).
export function DiffView({
  data,
  mode = "diff",
}: {
  readonly data: TemplateDiff;
  readonly mode?: "diff" | "full";
}): ReactNode {
  const t = useTranslation();
  if (mode === "diff" && data.identical) {
    return <EmptyState title={t("documentDesigner.editor.diff.identical")} />;
  }
  // Diff blocks have no identity beyond their position.
  const entries = data.blocks
    .map((block, position) => ({ block, key: `block-${position}` }))
    .filter(({ block }) => mode === "diff" || block.change !== "removed");
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1" data-testid="document-designer-diff">
        {entries.map(({ block, key }) => (
          <li
            key={key}
            data-change={block.change}
            className={`whitespace-pre-wrap rounded px-2 py-1 font-mono text-xs ${DIFF_TONE[block.change]}`}
          >
            {mode === "diff" && `${DIFF_MARK[block.change]} `}
            {block.content}
          </li>
        ))}
      </ul>
      {mode === "diff" && data.meta.length > 0 && (
        <ul className="flex flex-col gap-1" data-testid="document-designer-diff-meta">
          {data.meta.map((entry) => (
            <li key={entry.key} className="rounded bg-muted px-2 py-1 font-mono text-xs">
              {entry.key}: {metaValueText(entry.system)} → {metaValueText(entry.tenant)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DiffPanel({ tenantId }: { readonly tenantId: string }): ReactNode {
  const { data, loading, error, refetch } = useQuery<TemplateDiff>(
    TemplateResolverQueries.diffToSystem,
    { id: tenantId },
  );
  if (error !== null) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (loading || data === null) return <LoadingState />;
  return <DiffView data={data} />;
}

export function DiffDrawer({
  tenantId,
  onClose,
}: {
  readonly tenantId: string;
  readonly onClose: () => void;
}): ReactNode {
  const t = useTranslation();
  const { Drawer, Modal } = usePrimitives();
  const title = t("documentDesigner.editor.diff.title");
  const body = <DiffPanel tenantId={tenantId} />;
  const onOpenChange = (open: boolean): void => {
    if (!open) onClose();
  };
  return Drawer === undefined ? (
    <Modal open onOpenChange={onOpenChange} title={title}>
      {body}
    </Modal>
  ) : (
    <Drawer open onOpenChange={onOpenChange} title={title}>
      {body}
    </Drawer>
  );
}

function originText(
  t: ReturnType<typeof useTranslation>,
  args: {
    readonly isSystemAdmin: boolean;
    readonly source: LayoutSourceView;
    readonly kind: LayoutKind;
    readonly userCount: number;
    readonly overrides: TenantOverrideCounts | null;
  },
): string {
  const { isSystemAdmin, source, kind, userCount, overrides } = args;
  const systemVersion = source.system?.version ?? 0;
  if (isSystemAdmin) {
    if (overrides === null)
      return t("documentDesigner.editor.origin.platformPlain", { version: systemVersion });
    return overrides.totalTenants === null
      ? t("documentDesigner.editor.origin.platformCount", {
          version: systemVersion,
          active: overrides.activeOverrides,
        })
      : t("documentDesigner.editor.origin.platformOfTotal", {
          version: systemVersion,
          active: overrides.activeOverrides,
          total: overrides.totalTenants,
        });
  }
  const usesKey = kind === "mail-layout" ? "mails" : "pdfs";
  if (source.tenant !== null) {
    return t(`documentDesigner.editor.origin.tenant.${usesKey}`, {
      version: systemVersion,
      count: userCount,
    });
  }
  return source.system === null
    ? t("documentDesigner.editor.origin.none")
    : t("documentDesigner.editor.origin.system");
}

export function OriginBar({
  isSystemAdmin,
  source,
  kind,
  userCount,
  overrides,
  onReset,
  onResetError,
}: {
  readonly isSystemAdmin: boolean;
  readonly source: LayoutSourceView;
  readonly kind: LayoutKind;
  readonly userCount: number;
  readonly overrides: TenantOverrideCounts | null;
  readonly onReset: () => void;
  readonly onResetError: (message: string) => void;
}): ReactNode {
  const t = useTranslation();
  const { Button, Dialog } = usePrimitives();
  const [diffOpen, setDiffOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const resetToSystem = useMutation(TemplateResolverHandlers.resetToSystem);
  const { tenant, system } = source;
  const besideActive =
    isSystemAdmin || tenant === null ? null : draftBesideActiveSentence(t, tenant);
  const canDiff = tenant !== null && system?.contentFormat === "html";
  const canReset = tenant !== null && system !== null && !isSystemAdmin;

  const links = (
    <>
      {canDiff && (
        <Button
          variant="link"
          onClick={() => setDiffOpen(true)}
          testId="document-designer-diff-open"
        >
          {t("documentDesigner.editor.diff.open")}
        </Button>
      )}
      {canReset && (
        <Button
          variant="link"
          onClick={() => setResetOpen(true)}
          testId="document-designer-reset-open"
        >
          {t("documentDesigner.editor.reset.open")}
        </Button>
      )}
    </>
  );
  return (
    <EditorInfoBar
      tone={tenant !== null ? "active" : "muted"}
      testId="document-designer-origin-bar"
      origin={originOf(tenant === null, system !== null)}
      links={links}
      overlays={
        <>
          {diffOpen && tenant !== null && (
            <DiffDrawer tenantId={tenant.id} onClose={() => setDiffOpen(false)} />
          )}
          <Dialog
            open={resetOpen}
            onOpenChange={setResetOpen}
            title={t("documentDesigner.editor.reset.title")}
            description={t("documentDesigner.editor.reset.description")}
            confirmLabel={t("documentDesigner.editor.reset.confirm")}
            variant="danger"
            onConfirm={async () => {
              if (tenant === null) return;
              const result = await resetToSystem.mutate({ id: tenant.id });
              if (result.isSuccess) onReset();
              else onResetError(dispatcherErrorText(result.error, t));
            }}
          />
        </>
      }
    >
      {originText(t, { isSystemAdmin, source, kind, userCount, overrides })}
      {besideActive !== null && ` ${besideActive}`}
    </EditorInfoBar>
  );
}
