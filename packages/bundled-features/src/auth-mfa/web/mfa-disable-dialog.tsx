// MfaDisableDialog — confirm-with-code before turning MFA off. Uses the
// generic Dialog primitive (unlike MfaRegenerateRecoveryDialog): disable is
// single-step, no state to preserve after confirm, so
// it doesn't hit the "Dialog always closes after onConfirm" problem that
// ruled Dialog out for the multi-step enable/regenerate flows. Error
// reporting still has to go through the parent (onError) rather than an
// inline Banner, because Dialog closes in a `finally` regardless of
// whether onConfirm's write succeeded — see profile-screen.tsx's
// delete-account dialog for the same convention (StatusBanner rendered
// by the caller, not the dialog).

import { useDispatcher, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { AuthMfaHandlers } from "./constants.ts";
import { MfaCodeOrRecoveryField } from "./mfa-code-or-recovery-field.tsx";

export type MfaDisableDialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onDisabled: () => void;
  readonly onError: (i18nKey: string) => void;
};

// kumiko-lint-ignore no-custom-primitives Uses usePrimitives().Dialog internally, name is an MFA domain action, not a primitive reimplementation
export function MfaDisableDialog({
  open,
  onOpenChange,
  onDisabled,
  onError,
}: MfaDisableDialogProps): ReactNode {
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
    const res = await dispatcher.write<{ disabled: boolean }>(AuthMfaHandlers.disable, { code });
    reset();
    if (!res.isSuccess) {
      onError(res.error.i18nKey);
      return;
    }
    onDisabled();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      variant="danger"
      title={t("auth.mfa.disable.title")}
      description={t("auth.mfa.disable.description")}
      confirmLabel={t("auth.mfa.disable.confirm")}
      cancelLabel={t("auth.mfa.disable.cancel")}
      onConfirm={confirm}
      testId="mfa-disable-dialog"
    >
      <MfaCodeOrRecoveryField
        id="mfa-disable-code"
        codeLabel={t("auth.mfa.disable.code")}
        code={code}
        onCodeChange={setCode}
        useRecovery={useRecovery}
        onUseRecoveryChange={setUseRecovery}
      />
    </Dialog>
  );
}
