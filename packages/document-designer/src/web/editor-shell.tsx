// @runtime client
import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { cn } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";
import { type EditorOrigin, OriginBadge } from "./editor-header.tsx";
import { formatRelativeWhen } from "./relative-time.ts";

export type InfoBarTone = "active" | "muted" | "warn";
export type FooterTone = "bad" | "warn" | "ok";

const INFO_BAR_TONE: Readonly<Record<InfoBarTone, string>> = {
  active: "bg-primary/10",
  muted: "bg-muted",
  warn: "bg-status-warn-surface",
};

const FOOTER_TONE: Readonly<Record<FooterTone, { readonly text: string; readonly glyph: string }>> =
  {
    ok: { text: "text-status-ok", glyph: "✓" },
    warn: { text: "text-status-warn", glyph: "!" },
    bad: { text: "text-status-bad", glyph: "!" },
  };

// Height below the shell header: the rails and the center scroll on their own.
export function EditorFrame({
  testId,
  children,
}: {
  readonly testId: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div
      className="flex h-[calc(100svh-var(--shell-header-height))] min-h-[600px] flex-col"
      data-testid={testId}
    >
      {children}
    </div>
  );
}

export function EditorInfoBar({
  tone,
  testId,
  origin,
  controls,
  links,
  overlays,
  children,
}: {
  readonly tone: InfoBarTone;
  readonly testId: string;
  readonly origin?: EditorOrigin | null;
  /** Right side, before the links: locale switch and the editor's secondary action. */
  readonly controls?: ReactNode;
  readonly links?: ReactNode;
  readonly overlays?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <>
      <div
        className={cn("flex items-start gap-4 border-b px-6 py-2 text-sm", INFO_BAR_TONE[tone])}
        data-testid={testId}
        data-variant={tone === "warn" ? "warn" : undefined}
      >
        <span className="min-w-0 flex-1">
          {origin != null && <OriginBadge origin={origin} />} {children}
        </span>
        {controls !== undefined && (
          <div className="flex shrink-0 items-center gap-2">{controls}</div>
        )}
        {links !== undefined && <div className="flex shrink-0 items-center gap-4">{links}</div>}
      </div>
      {overlays}
    </>
  );
}

export function EditorBody({
  left,
  center,
  right,
  testId,
}: {
  readonly left?: ReactNode;
  readonly center: ReactNode;
  readonly right: ReactNode;
  readonly testId?: string;
}): ReactNode {
  return (
    <div
      className={cn(
        "grid min-h-0 flex-1",
        left === undefined
          ? "grid-cols-[minmax(0,1fr)_280px]"
          : "grid-cols-[240px_minmax(0,1fr)_280px]",
      )}
      data-testid={testId}
    >
      {left !== undefined && (
        <aside className="min-h-0 overflow-y-auto border-r bg-background">{left}</aside>
      )}
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-muted">{center}</div>
      <aside className="min-h-0 overflow-y-auto border-l bg-background">{right}</aside>
    </div>
  );
}

export function EditorFooter({
  testIdPrefix,
  message,
  saveError,
  modifiedAt,
  dirty,
  busy,
  canSave,
  canPublish,
  onDiscard,
  onSave,
  onPublish,
}: {
  readonly testIdPrefix: string;
  readonly message: { readonly tone: FooterTone; readonly text: string } | null;
  readonly saveError: string | null;
  readonly modifiedAt: string | null;
  readonly dirty: boolean;
  readonly busy: boolean;
  readonly canSave: boolean;
  readonly canPublish: boolean;
  readonly onDiscard: () => void;
  readonly onSave: () => void;
  readonly onPublish: () => void;
}): ReactNode {
  const t = useTranslation();
  const { Banner, Button, Text } = usePrimitives();
  const tone = message === null ? null : FOOTER_TONE[message.tone];
  return (
    <div
      className="flex items-center gap-4 border-t bg-background px-6 py-3"
      data-testid={`${testIdPrefix}-footer`}
    >
      <div className="min-w-0 flex-1 text-sm">
        {saveError !== null ? (
          <Banner variant="error" testId={`${testIdPrefix}-save-error`}>
            {saveError}
          </Banner>
        ) : (
          <span
            className={cn(tone === null ? "text-muted-foreground" : tone.text)}
            data-testid={`${testIdPrefix}-footer-message`}
            data-tone={message?.tone}
          >
            {message === null
              ? t("documentDesigner.editor.footer.checking")
              : `${tone?.glyph ?? ""} ${message.text}`}
          </span>
        )}
        {modifiedAt !== null && (
          <>
            {" "}
            <Text variant="muted" testId={`${testIdPrefix}-saved-at`}>
              {t("documentDesigner.mail.footer.savedAt", { when: formatRelativeWhen(modifiedAt) })}
            </Text>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Button
          variant="ghost"
          disabled={!dirty}
          onClick={onDiscard}
          testId="document-designer-discard"
        >
          {t("documentDesigner.editor.discard")}
        </Button>
        <Button
          variant="secondary"
          disabled={!canSave}
          loading={busy}
          onClick={onSave}
          testId="document-designer-save"
        >
          {t("documentDesigner.editor.save")}
        </Button>
        <Button disabled={!canPublish} onClick={onPublish} testId="document-designer-publish">
          {t("documentDesigner.editor.publish")}
        </Button>
      </div>
    </div>
  );
}
