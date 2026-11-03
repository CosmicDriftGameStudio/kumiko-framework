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
  readonly required?: boolean;
  readonly hasError?: boolean;
  /** Remounts the input, e.g. to regain focus after a disabled submit. */
  readonly inputKey?: string;
  readonly onComplete?: (code: string) => void;
};

export function MfaCodeOrRecoveryField({
  id,
  codeLabel,
  code,
  onCodeChange,
  useRecovery,
  onUseRecoveryChange,
  disabled,
  required,
  hasError,
  inputKey,
  onComplete,
}: MfaCodeOrRecoveryFieldProps): ReactNode {
  const t = useTranslation();
  const { Button, Field, Input } = usePrimitives();

  return (
    <>
      <Field id={id} label={useRecovery ? t("auth.mfa.verify.recoveryCode") : codeLabel} required>
        {useRecovery ? (
          <Input
            key={inputKey}
            kind="text"
            id={id}
            name={id}
            value={code}
            // Pasted recovery codes often carry a trailing space or newline; the server rejects them by length.
            onChange={(next) => onCodeChange(next.trim())}
            disabled={disabled}
            required={required}
            autoFocus
            autoComplete="off"
          />
        ) : (
          <Input
            key={inputKey}
            kind="code"
            length={6}
            id={id}
            name={id}
            value={code}
            onChange={onCodeChange}
            onComplete={onComplete}
            disabled={disabled}
            hasError={hasError}
            required={required}
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
