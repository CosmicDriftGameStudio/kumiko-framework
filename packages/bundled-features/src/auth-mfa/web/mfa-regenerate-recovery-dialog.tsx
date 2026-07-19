// @runtime client
// MfaRegenerateRecoveryDialog — confirm-with-code, then the caller reveals
// the new codes. The reveal itself can't live inside this Dialog: Dialog
// closes in a `finally` right after onConfirm resolves (see profile-screen.
// tsx's delete-account dialog for the same constraint), so there's no way
// to keep it open to show the result. onRegenerated hands the new codes to
// the caller, which is expected to render them via MfaRecoveryCodesReveal
// (or equivalent) once the dialog has closed.

import { useDispatcher, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { AuthMfaHandlers } from "../constants";

export type MfaRegenerateRecoveryDialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRegenerated: (codes: readonly string[]) => void;
  readonly onError: (i18nKey: string) => void;
};

export function MfaRegenerateRecoveryDialog({
  open,
  onOpenChange,
  onRegenerated,
  onError,
}: MfaRegenerateRecoveryDialogProps): ReactNode {
  const t = useTranslation();
  const { Dialog, Field, Input } = usePrimitives();
  const dispatcher = useDispatcher();
  const [code, setCode] = useState("");

  const confirm = async (): Promise<void> => {
    const res = await dispatcher.write<{ recoveryCodes: readonly string[] }>(
      AuthMfaHandlers.regenerateRecovery,
      { code },
    );
    setCode("");
    if (!res.isSuccess) {
      onError(res.error.i18nKey);
      return;
    }
    onRegenerated(res.data.recoveryCodes);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("auth.mfa.regenerate.title")}
      description={t("auth.mfa.regenerate.description")}
      confirmLabel={t("auth.mfa.regenerate.confirm")}
      cancelLabel={t("auth.mfa.regenerate.cancel")}
      onConfirm={confirm}
      testId="mfa-regenerate-recovery-dialog"
    >
      <Field id="mfa-regenerate-code" label={t("auth.mfa.regenerate.code")} required>
        <Input
          kind="text"
          id="mfa-regenerate-code"
          name="mfa-regenerate-code"
          value={code}
          onChange={setCode}
          autoComplete="one-time-code"
        />
      </Field>
    </Dialog>
  );
}
