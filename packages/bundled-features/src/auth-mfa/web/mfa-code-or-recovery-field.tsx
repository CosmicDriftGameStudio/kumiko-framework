import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";

export type MfaCodeOrRecoveryFieldProps = {
  readonly id: string;
  readonly codeLabel: string;
  readonly code: string;
  readonly onCodeChange: (code: string) => void;
  readonly useRecovery: boolean;
  readonly onUseRecoveryChange: (useRecovery: boolean) => void;
  readonly disabled?: boolean;
};

export function MfaCodeOrRecoveryField({
  id,
  codeLabel,
  code,
  onCodeChange,
  useRecovery,
  onUseRecoveryChange,
  disabled,
}: MfaCodeOrRecoveryFieldProps): ReactNode {
  const t = useTranslation();
  const { Button, Field, Input } = usePrimitives();

  return (
    <>
      <Field id={id} label={useRecovery ? t("auth.mfa.verify.recoveryCode") : codeLabel} required>
        {useRecovery ? (
          <Input
            kind="text"
            id={id}
            name={id}
            value={code}
            onChange={onCodeChange}
            disabled={disabled}
            autoFocus
            autoComplete="off"
          />
        ) : (
          <Input
            kind="code"
            length={6}
            id={id}
            name={id}
            value={code}
            onChange={onCodeChange}
            disabled={disabled}
            autoFocus
          />
        )}
      </Field>
      <Button
        type="button"
        variant="link"
        disabled={disabled}
        onClick={() => {
          onUseRecoveryChange(!useRecovery);
          onCodeChange("");
        }}
      >
        {useRecovery
          ? t("auth.mfa.verify.useAuthenticatorCode")
          : t("auth.mfa.verify.useRecoveryCode")}
      </Button>
    </>
  );
}
