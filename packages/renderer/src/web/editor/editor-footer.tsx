import type { ReactNode } from "react";
import { useTranslation } from "../../i18n.tsx";
import { usePrimitives } from "../../primitives.tsx";
import { cn } from "../lib/cn.ts";
import { formatRelativeWhen } from "./relative-when.ts";

export type FooterTone = "bad" | "warn" | "ok";

const FOOTER_TONE: Readonly<Record<FooterTone, { readonly text: string; readonly glyph: string }>> =
  {
    ok: { text: "text-status-ok", glyph: "✓" },
    warn: { text: "text-status-warn", glyph: "!" },
    bad: { text: "text-status-bad", glyph: "!" },
  };

export type EditorActionTestIds = {
  readonly discard: string;
  readonly save: string;
  readonly publish: string;
};

const DEFAULT_ACTION_TEST_IDS: EditorActionTestIds = {
  discard: "editor-discard",
  save: "editor-save",
  publish: "editor-publish",
};

export function EditorFooter({
  testIdPrefix,
  actionTestIds = DEFAULT_ACTION_TEST_IDS,
  message,
  pendingMessage,
  saveError,
  modifiedAt,
  dirty,
  busy,
  canSave,
  canPublish,
  onDiscard,
  onSave,
  saveLabel,
  onPublish,
}: {
  readonly testIdPrefix: string;
  readonly actionTestIds?: EditorActionTestIds;
  readonly message: { readonly tone: FooterTone; readonly text: string } | null;
  /** Shown while `message` is null (a check still running, or nothing to report). */
  readonly pendingMessage?: string;
  readonly saveError: string | null;
  readonly modifiedAt: string | null;
  readonly dirty: boolean;
  readonly busy: boolean;
  readonly canSave: boolean;
  readonly canPublish?: boolean;
  readonly onDiscard: () => void;
  readonly onSave: () => void;
  readonly saveLabel?: string;
  /** Without it the footer has no publish button (content that is live as soon as it is saved). */
  readonly onPublish?: () => void;
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
              ? (pendingMessage ?? t("kumiko.editor.noChanges"))
              : `${tone?.glyph ?? ""} ${message.text}`}
          </span>
        )}
        {modifiedAt !== null && (
          <>
            {" "}
            <Text variant="muted" testId={`${testIdPrefix}-saved-at`}>
              {t("kumiko.editor.savedAt", { when: formatRelativeWhen(modifiedAt) })}
            </Text>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Button
          variant="ghost"
          disabled={!dirty}
          onClick={onDiscard}
          testId={actionTestIds.discard}
        >
          {t("kumiko.editor.discard")}
        </Button>
        <Button
          variant={onPublish === undefined ? "primary" : "secondary"}
          disabled={!canSave}
          loading={busy}
          onClick={onSave}
          testId={actionTestIds.save}
        >
          {saveLabel ?? t("kumiko.actions.save")}
        </Button>
        {onPublish !== undefined && (
          <Button disabled={canPublish !== true} onClick={onPublish} testId={actionTestIds.publish}>
            {t("kumiko.editor.publish")}
          </Button>
        )}
      </div>
    </div>
  );
}
