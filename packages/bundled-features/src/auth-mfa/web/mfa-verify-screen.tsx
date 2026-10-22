// Login challenge step, rendered when LoginScreen's onMfaChallenge fires
// (/auth/login returned mfaRequired). It follows login-screen.tsx:
// useState plus a direct fetch call, without a dispatcher because no JWT
// exists yet. After success, it calls session.refresh() instead of a hard
// reload so the caller (typically wizard state in the app root) can render
// immediately when status:"authenticated" arrives.

import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type FormEvent, type ReactNode, useState } from "react";
// kumiko-lint-ignore cross-feature-import client-only barrel, the feature's server barrel has no web/ re-export
import { AuthCard, useSession } from "../../auth-email-password/web/index.ts";
import { verifyMfaChallenge } from "./mfa-client.ts";

export type MfaVerifyScreenProps = {
  readonly challengeToken: string;
  readonly title?: string;
  readonly subtitle?: ReactNode;
  readonly submitLabel?: string;
  /** Called after the server confirms the code and the session state has
   *  refreshed. Optional — apps that swap this screen back out purely on
   *  session.status changing to "authenticated" don't need it. */
  readonly onSuccess?: (landingPath?: string) => void;
  // Some failures (challenge_expired, too_many_attempts) have no retry path —
  // the challengeToken is dead. Without this, the host has no way back to
  // login short of a full page reload. Optional: apps that always mount
  // this screen fresh per challenge can omit it.
  readonly onCancel?: () => void;
};

type CodeEntryMode = "authenticator" | "recovery";

const MFA_CODE_LENGTH = 6;

function reasonToKey(reason: string): string {
  switch (reason) {
    case "invalid_totp_code":
    case "invalid_recovery_code":
    case "invalid_code":
      return "auth.mfa.errors.invalidCode";
    case "challenge_expired":
    case "invalid_challenge_token":
      return "auth.mfa.errors.challengeExpired";
    case "too_many_attempts":
      return "auth.mfa.errors.tooManyAttempts";
    case "rate_limited":
      return "auth.errors.rateLimited";
    default:
      return "auth.mfa.errors.verifyFailed";
  }
}

export function MfaVerifyScreen({
  challengeToken,
  title,
  subtitle,
  submitLabel,
  onSuccess,
  onCancel,
}: MfaVerifyScreenProps): ReactNode {
  const t = useTranslation();
  const { Form, Field, Input, Button, Banner } = usePrimitives();
  const session = useSession();
  const [mode, setMode] = useState<CodeEntryMode>("authenticator");
  const [code, setCode] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doSubmit = async (submittedCode: string): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const res = await verifyMfaChallenge(challengeToken, submittedCode);
    if (res.kind === "success") {
      await session.refresh();
      setSubmitting(false);
      onSuccess?.(res.data.landingPath);
      return;
    }
    setSubmitting(false);
    setError(res.error.reason);
    // Remount: the input was disabled during submit and lost focus.
    setAttempt((n) => n + 1);
    if (mode === "authenticator") setCode("");
  };

  const onSubmit = (e?: FormEvent): void => {
    e?.preventDefault();
    void doSubmit(code);
  };

  const toggleMode = (): void => {
    setMode(mode === "authenticator" ? "recovery" : "authenticator");
    setCode("");
    setError(null);
  };

  const isRecovery = mode === "recovery";
  const fieldId = isRecovery ? "mfa-verify-recovery-code" : "mfa-verify-code";
  const defaultSubtitle = isRecovery
    ? t("auth.mfa.verify.recoverySubtitle")
    : t("auth.mfa.verify.subtitle");

  return (
    <AuthCard title={title ?? t("auth.mfa.verify.title")} subtitle={subtitle ?? defaultSubtitle}>
      <Form onSubmit={onSubmit}>
        <Field
          id={fieldId}
          label={isRecovery ? t("auth.mfa.verify.recoveryCode") : t("auth.mfa.verify.code")}
          required
        >
          {isRecovery ? (
            <Input
              key={`${mode}-${attempt}`}
              kind="text"
              id={fieldId}
              name={fieldId}
              value={code}
              onChange={setCode}
              disabled={submitting}
              required
              autoFocus
              autoComplete="off"
            />
          ) : (
            <Input
              key={`${mode}-${attempt}`}
              kind="code"
              length={MFA_CODE_LENGTH}
              id={fieldId}
              name={fieldId}
              value={code}
              onChange={setCode}
              onComplete={(next) => void doSubmit(next)}
              disabled={submitting}
              hasError={error !== null}
              required
              autoFocus
            />
          )}
        </Field>
        {error !== null ? <Banner variant="error">{t(reasonToKey(error))}</Banner> : null}
        <Button type="submit" loading={submitting} disabled={submitting}>
          {submitting
            ? t("auth.mfa.verify.submitting")
            : (submitLabel ?? t("auth.mfa.verify.submit"))}
        </Button>
        <Button type="button" variant="link" onClick={toggleMode} disabled={submitting}>
          {isRecovery
            ? t("auth.mfa.verify.useAuthenticatorCode")
            : t("auth.mfa.verify.useRecoveryCode")}
        </Button>
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
            {t("auth.mfa.verify.backToLogin")}
          </Button>
        ) : null}
      </Form>
    </AuthCard>
  );
}
