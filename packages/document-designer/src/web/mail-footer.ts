// @runtime client
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

const MAIL_META_FIELDS = ["subject", "previewText"] as const;
export type MailMetaField = (typeof MAIL_META_FIELDS)[number];

// The server names the setting and the reason per issue; the field itself shows that sentence.
export function metaFieldMessages(
  t: Translate,
  validation: MailValidation | null,
): Partial<Record<MailMetaField, string>> {
  if (validation === null) return {};
  const messages: Partial<Record<MailMetaField, string>> = {};
  for (const field of MAIL_META_FIELDS) {
    const issue = validation.issues.find((candidate) => candidate.path === `meta.${field}`);
    if (issue !== undefined) messages[field] = issueText(t, issue);
  }
  return messages;
}
