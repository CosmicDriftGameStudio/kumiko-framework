// @runtime client
// Login-Challenge-Step, gerendert wenn LoginScreen's onMfaChallenge feuert
// (/auth/login antwortete mfaRequired). Stilistisch wie login-screen.tsx:
// useState + direkter fetch-Call, kein Dispatcher — es existiert noch kein
// JWT. Nach Erfolg ruft es session.refresh() statt eines Hard-Reloads, weil
// der Aufrufer (typisch ein Wizard-State im App-Root) sofort neu rendern
// will, sobald status:"authenticated" ankommt.

import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type FormEvent, type ReactNode, useState } from "react";
// kumiko-lint-ignore cross-feature-import client-only barrel, the feature's server barrel has no web/ re-export
import { AuthCard, useSession } from "../../auth-email-password/web";
import { verifyMfaChallenge } from "./mfa-client";

export type MfaVerifyScreenProps = {
  readonly challengeToken: string;
  readonly title?: string;
  readonly subtitle?: ReactNode;
  readonly submitLabel?: string;
  /** Called after the server confirms the code and the session state has
   *  refreshed. Optional — apps that swap this screen back out purely on
   *  session.status changing to "authenticated" don't need it. */
  readonly onSuccess?: () => void;
};

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
}: MfaVerifyScreenProps): ReactNode {
  const t = useTranslation();
  const { Form, Field, Input, Button, Banner } = usePrimitives();
  const session = useSession();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doSubmit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    const res = await verifyMfaChallenge(challengeToken, code);
    if (res.kind === "success") {
      await session.refresh();
      setSubmitting(false);
      onSuccess?.();
      return;
    }
    setSubmitting(false);
    setError(res.error.reason);
  };

  const onSubmit = (e?: FormEvent): void => {
    e?.preventDefault();
    void doSubmit();
  };

  return (
    <AuthCard
      title={title ?? t("auth.mfa.verify.title")}
      subtitle={subtitle ?? t("auth.mfa.verify.subtitle")}
    >
      <div className="p-6 pt-0 flex flex-col gap-4">
        <Form onSubmit={onSubmit}>
          <Field id="mfa-verify-code" label={t("auth.mfa.verify.code")} required>
            <Input
              kind="text"
              id="mfa-verify-code"
              name="mfa-verify-code"
              value={code}
              onChange={setCode}
              disabled={submitting}
              required
              autoComplete="one-time-code"
            />
          </Field>
          {error !== null ? <Banner variant="error">{t(reasonToKey(error))}</Banner> : null}
          <Button type="submit" loading={submitting} disabled={submitting}>
            {submitting
              ? t("auth.mfa.verify.submitting")
              : (submitLabel ?? t("auth.mfa.verify.submit"))}
          </Button>
        </Form>
      </div>
    </AuthCard>
  );
}
