import type { FooterTone } from "./editor-shell.tsx";
import type { ValidationResult } from "./types.ts";
import { variableLabelText } from "./used-by-label.ts";

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

export type GeneratedProbe = {
  readonly pages: number;
  readonly sizeBytes: number;
  readonly durationMs: number;
};

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// One sentence like the mail footer: missing required placeholders first, then other blocking
// issues, then warnings, else "ready" plus the last test run.
export function pdfFooterMessage(
  t: Translate,
  validation: ValidationResult,
  probe: GeneratedProbe | null,
): { readonly tone: FooterTone; readonly text: string } {
  if (validation.missingRequired.length > 0) {
    const names = validation.missingRequired
      .map((name) => variableLabelText(t, name, validation.variables[name]?.label))
      .join(", ");
    return { tone: "bad", text: t("documentDesigner.validation.missingRequired", { name: names }) };
  }
  const blocking = [...validation.issues, ...validation.publishIssues][0];
  if (blocking !== undefined) {
    const translated = t(blocking.i18nKey, blocking.params);
    return { tone: "bad", text: translated === blocking.i18nKey ? blocking.code : translated };
  }
  const warning = validation.warnings[0];
  if (warning !== undefined) {
    const translated = t(warning.i18nKey, { detail: warning.detail });
    return { tone: "warn", text: translated === warning.i18nKey ? warning.code : translated };
  }
  const ok = t("documentDesigner.validation.ok");
  if (probe === null) return { tone: "ok", text: ok };
  const lastProbe = t("documentDesigner.validation.lastProbe", {
    pages: probe.pages,
    size: formatSize(probe.sizeBytes),
    seconds: (probe.durationMs / 1000).toFixed(1),
  });
  return { tone: "ok", text: `${ok} ${lastProbe}` };
}
