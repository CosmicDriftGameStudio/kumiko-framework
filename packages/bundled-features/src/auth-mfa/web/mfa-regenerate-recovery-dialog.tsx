// MfaRegenerateRecoveryDialog — confirm-with-code, then the caller reveals
// the new codes. The reveal itself can't live inside this Dialog: Dialog
// closes in a `finally` right after onConfirm resolves (see profile-screen.
// tsx's delete-account dialog for the same constraint), so there's no way
// to keep it open to show the result. onRegenerated hands the new codes to
// the caller, which is expected to render them via MfaRecoveryCodesReveal
// (or equivalent) once the dialog has closed.

import { useDispatcher, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { AuthMfaHandlers } from "./constants.ts";
import { MfaCodeOrRecoveryField } from "./mfa-code-or-recovery-field.tsx";

export type MfaRegenerateRecoveryDialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRegenerated: (codes: readonly string[]) => void;
  readonly onError: (i18nKey: string) => void;
};

// kumiko-lint-ignore no-custom-primitives Uses usePrimitives().Dialog internally, name is an MFA domain action, not a primitive reimplementation
export function MfaRegenerateRecoveryDialog({
  open,
  onOpenChange,
  onRegenerated,
  onError,
}: MfaRegenerateRecoveryDialogProps): ReactNode {
  const t = useTranslation();
  const { Dialog } = usePrimitives();
  const dispatcher = useDispatcher();
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);

  const reset = (): void => {
    setCode("");
    setUseRecovery(false);
  };

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const confirm = async (): Promise<void> => {
    const res = await dispatcher.write<{ recoveryCodes: readonly string[] }>(
      AuthMfaHandlers.regenerateRecovery,
      { code },
    );
    reset();
    if (!res.isSuccess) {
      onError(res.error.i18nKey);
      return;
    }
    onRegenerated(res.data.recoveryCodes);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t("auth.mfa.regenerate.title")}
      description={t("auth.mfa.regenerate.description")}
      confirmLabel={t("auth.mfa.regenerate.confirm")}
      cancelLabel={t("auth.mfa.regenerate.cancel")}
      onConfirm={confirm}
      testId="mfa-regenerate-recovery-dialog"
    >
      <MfaCodeOrRecoveryField
        id="mfa-regenerate-code"
        codeLabel={t("auth.mfa.regenerate.code")}
        code={code}
        onCodeChange={setCode}
        useRecovery={useRecovery}
        onUseRecoveryChange={setUseRecovery}
      />
    </Dialog>
  );
}
