// @runtime client
import { formatWhen, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import type { ValidationIssue } from "./layout-types.js";
import type { MailValidation } from "./mail-types.js";

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

function issueText(t: Translate, issue: ValidationIssue): string {
  const translated = t(issue.i18nKey, issue.params);
  return translated === issue.i18nKey ? issue.code : translated;
}

function missingLabels(validation: MailValidation): string {
  return validation.missingRequired
    .map((name) => validation.variables[name]?.label ?? name)
    .join(", ");
}

// The footer sentence: missing required placeholders first, then other blocking issues,
// then hints (not-yet-uploaded resources), else "ready".
export function footerMessage(
  t: Translate,
  validation: MailValidation,
  previewMode: boolean,
): { readonly tone: "bad" | "warn" | "ok"; readonly text: string } {
  if (validation.missingRequired.length > 0) {
    return {
      tone: "bad",
      text: t(
        previewMode
          ? "documentDesigner.mail.footer.missingPreview"
          : "documentDesigner.mail.footer.missing",
        { names: missingLabels(validation) },
      ),
    };
  }
  const blocking = [...validation.issues, ...validation.publishIssues][0];
  if (blocking !== undefined) return { tone: "bad", text: issueText(t, blocking) };
  const warning = validation.warnings[0];
  if (warning !== undefined) {
    const translated = t(warning.i18nKey, { detail: warning.detail });
    return { tone: "warn", text: translated === warning.i18nKey ? warning.code : translated };
  }
  return { tone: "ok", text: t("documentDesigner.mail.footer.ok") };
}

const TONE_CLASS = {
  bad: "text-status-bad",
  warn: "text-status-warn",
  ok: "text-status-ok",
} as const;

export function MailFooter({
  validation,
  previewMode,
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
  readonly validation: MailValidation | null;
  readonly previewMode: boolean;
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
  const message = validation === null ? null : footerMessage(t, validation, previewMode);
  return (
    <div
      className="flex flex-wrap items-center gap-3 border-t pt-3"
      data-testid="mail-editor-footer"
    >
      {saveError !== null ? (
        <Banner variant="error" testId="mail-editor-save-error">
          {saveError}
        </Banner>
      ) : (
        <span
          className={`text-sm ${message === null ? "text-muted-foreground" : TONE_CLASS[message.tone]}`}
          data-testid="mail-editor-footer-message"
          data-tone={message?.tone}
        >
          {message === null ? t("documentDesigner.editor.footer.checking") : message.text}
        </span>
      )}
      <div className="grow" />
      {modifiedAt !== null && (
        <Text variant="muted" testId="mail-editor-saved-at">
          {t("documentDesigner.mail.footer.savedAt", { when: formatWhen(modifiedAt) })}
        </Text>
      )}
      {dirty && (
        <Button variant="ghost" onClick={onDiscard} testId="document-designer-discard">
          {t("documentDesigner.editor.discard")}
        </Button>
      )}
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
  );
}
