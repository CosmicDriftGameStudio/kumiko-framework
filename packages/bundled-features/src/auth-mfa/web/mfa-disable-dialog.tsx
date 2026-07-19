// @runtime client
// MfaDisableDialog — confirm-with-code before turning MFA off. Uses the
// generic Dialog primitive (unlike MfaEnableScreen/MfaRegenerateRecovery-
// Dialog): disable is single-step, no state to preserve after confirm, so
// it doesn't hit the "Dialog always closes after onConfirm" problem that
// ruled Dialog out for the multi-step enable/regenerate flows. Error
// reporting still has to go through the parent (onError) rather than an
// inline Banner, because Dialog closes in a `finally` regardless of
// whether onConfirm's write succeeded — see profile-screen.tsx's
// delete-account dialog for the same convention (StatusBanner rendered
// by the caller, not the dialog).

import { useDispatcher, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { AuthMfaHandlers } from "../constants";
import { mfaManageErrorKey } from "./mfa-error-keys";

export type MfaDisableDialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onDisabled: () => void;
  readonly onError: (i18nKey: string) => void;
};

export function MfaDisableDialog({
  open,
  onOpenChange,
  onDisabled,
  onError,
}: MfaDisableDialogProps): ReactNode {
  const t = useTranslation();
  const { Dialog, Field, Input } = usePrimitives();
  const dispatcher = useDispatcher();
  const [code, setCode] = useState("");

  const confirm = async (): Promise<void> => {
    const res = await dispatcher.write<{ disabled: boolean }>(AuthMfaHandlers.disable, { code });
    setCode("");
    if (!res.isSuccess) {
      onError(mfaManageErrorKey(res.error.code));
      return;
    }
    onDisabled();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      variant="danger"
      title={t("auth.mfa.disable.title")}
      description={t("auth.mfa.disable.description")}
      confirmLabel={t("auth.mfa.disable.confirm")}
      cancelLabel={t("auth.mfa.disable.cancel")}
      onConfirm={confirm}
      testId="mfa-disable-dialog"
    >
      <Field id="mfa-disable-code" label={t("auth.mfa.disable.code")} required>
        <Input
          kind="text"
          id="mfa-disable-code"
          name="mfa-disable-code"
          value={code}
          onChange={setCode}
          autoComplete="one-time-code"
        />
      </Field>
    </Dialog>
  );
}
