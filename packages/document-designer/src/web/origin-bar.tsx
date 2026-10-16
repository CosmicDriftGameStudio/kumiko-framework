// @runtime client
import {
  TemplateResolverHandlers,
  TemplateResolverQueries,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { useMutation, usePrimitives, useQuery, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { EmptyState, LoadingState } from "@cosmicdrift/kumiko-renderer-web";
import { type ReactNode, useState } from "react";
import type {
  LayoutKind,
  LayoutSourceView,
  TemplateDiff,
  TenantOverrideCounts,
} from "./layout-types.js";

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
  if (value === undefined || value === null) return "–";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function DiffPanel({ tenantId }: { readonly tenantId: string }): ReactNode {
  const t = useTranslation();
  const { data, loading } = useQuery<TemplateDiff>(TemplateResolverQueries.diffToSystem, {
    id: tenantId,
  });
  if (loading || data === null) return <LoadingState />;
  if (data.identical) return <EmptyState title={t("documentDesigner.editor.diff.identical")} />;
  // Diff blocks have no identity beyond their position.
  const entries = data.blocks.map((block, position) => ({ block, key: `block-${position}` }));
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1" data-testid="document-designer-diff">
        {entries.map(({ block, key }) => (
          <li
            key={key}
            data-change={block.change}
            className={`whitespace-pre-wrap rounded px-2 py-1 font-mono text-xs ${DIFF_TONE[block.change]}`}
          >
            {DIFF_MARK[block.change]} {block.content}
          </li>
        ))}
      </ul>
      {data.meta.length > 0 && (
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
}: {
  readonly isSystemAdmin: boolean;
  readonly source: LayoutSourceView;
  readonly kind: LayoutKind;
  readonly userCount: number;
  readonly overrides: TenantOverrideCounts | null;
  readonly onReset: () => void;
}): ReactNode {
  const t = useTranslation();
  const { Button, Dialog, Drawer, Modal, Text } = usePrimitives();
  const [diffOpen, setDiffOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const resetToSystem = useMutation(TemplateResolverHandlers.resetToSystem);
  const { tenant, system } = source;
  const canDiff = tenant !== null && system?.contentFormat === "html";
  const canReset = tenant !== null && system !== null && !isSystemAdmin;

  const diffTitle = t("documentDesigner.editor.diff.title");
  const diffBody = tenant === null ? null : <DiffPanel tenantId={tenant.id} />;

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border bg-muted px-4 py-2.5"
      data-testid="document-designer-origin-bar"
    >
      <Text>{originText(t, { isSystemAdmin, source, kind, userCount, overrides })}</Text>
      <div className="grow" />
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
      {diffOpen &&
        (Drawer === undefined ? (
          <Modal open onOpenChange={setDiffOpen} title={diffTitle}>
            {diffBody}
          </Modal>
        ) : (
          <Drawer open onOpenChange={setDiffOpen} title={diffTitle}>
            {diffBody}
          </Drawer>
        ))}
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
        }}
      />
    </div>
  );
}
