// @runtime client
// MfaRecoveryCodesReveal — one-time display of a fresh recovery-code set,
// with an acknowledge-then-dismiss gate (same UX as the codes block in
// MfaEnableScreen). Standalone so MfaRegenerateRecoveryDialog's caller can
// render it after the dialog closes — the codes only exist in memory for
// this one render, never persisted anywhere the app could show them again.

import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";

export type MfaRecoveryCodesRevealProps = {
  readonly codes: readonly string[];
  readonly onDismiss: () => void;
};

export function MfaRecoveryCodesReveal({
  codes,
  onDismiss,
}: MfaRecoveryCodesRevealProps): ReactNode {
  const t = useTranslation();
  const { Button, Field, Input, Section } = usePrimitives();
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <Section
      testId="mfa-regenerate-reveal"
      actions={
        <Button variant="primary" onClick={onDismiss} disabled={!acknowledged}>
          {t("auth.mfa.regenerate.done")}
        </Button>
      }
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="text-sm font-semibold">{t("auth.mfa.regenerate.newCodesTitle")}</span>
        <span className="text-xs text-muted-foreground">
          {t("auth.mfa.regenerate.newCodesHint")}
        </span>
        <code className="inline-block whitespace-pre-wrap break-all rounded bg-muted px-3 py-2 font-mono text-sm">
          {codes.join("\n")}
        </code>
      </div>
      <Field id="mfa-regenerate-ack" label={t("auth.mfa.regenerate.acknowledge")}>
        <Input
          kind="boolean"
          id="mfa-regenerate-ack"
          name="mfa-regenerate-ack"
          value={acknowledged}
          onChange={setAcknowledged}
        />
      </Field>
    </Section>
  );
}
