// @runtime client
// Pre-auth twin of MfaEnableScreen: a user blocked at login by MFA
// enforcement and not yet enrolled lands here straight out of the login
// flow — there is no session yet. Identity comes entirely from the
// preauthSetupToken login()'s mfa-setup-required result carries (see
// auth-client.ts's LoginResult). Calls startMfaSetupPreauth/confirmMfa-
// SetupPreauth directly via fetch (mfa-client.ts) — no useSession(), no
// useDispatcher(), both assume a real session that doesn't exist here.
//
// Session contract: a successful confirm mints cookie+JWT server-side, but
// THIS component does not refresh the session itself (unlike MfaVerify-
// Screen, which calls session.refresh() internally). onSuccess fires right
// after confirm — the caller (e.g. auth-gate's LoginRoute, which already
// has useSession() in scope) must call refresh() there, otherwise the app
// stays "unauthenticated" until the next reload.

import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
// qrcode's package.json#browser remap avoids Node-only deps (yargs/pngjs)
// for bundlers that honor it — Metro doesn't, hence the explicit subpath.
import QRCode from "qrcode/lib/browser";
import { type FormEvent, type ReactNode, useState } from "react";
// kumiko-lint-ignore cross-feature-import client-only component, the feature's server barrel has no web/ re-export
import { AuthCard } from "../../auth-email-password/web";
import { confirmMfaSetupPreauth, startMfaSetupPreauth } from "./mfa-client";

type SetupState = {
  readonly setupToken: string;
  readonly secretParam: string;
  readonly recoveryCodes: readonly string[];
  readonly qrSvg: string;
};

// otpauth:// URIs put the secret in the query string — extract it for the
// manual-entry fallback (authenticator apps without a camera / desktop use).
function extractSecret(otpauthUri: string): string {
  const query = otpauthUri.split("?")[1] ?? "";
  return new URLSearchParams(query).get("secret") ?? "";
}

function reasonToKey(reason: string): string {
  switch (reason) {
    case "invalid_totp_code":
      return "auth.mfa.errors.invalidCode";
    case "mfa_already_enabled":
      return "auth.mfa.errors.mfaAlreadyEnabled";
    case "invalid_setup_token":
      return "auth.mfa.errors.invalidSetupToken";
    case "invalid_challenge_token":
      return "auth.mfa.errors.challengeExpired";
    case "too_many_attempts":
      return "auth.mfa.errors.tooManyAttempts";
    case "rate_limited":
      return "auth.errors.rateLimited";
    default:
      return "auth.mfa.errors.setupFailed";
  }
}

export type MfaSetupPreauthScreenProps = {
  readonly preauthSetupToken: string;
  /** Account label for the otpauth:// URI (typically the email typed at
   *  login) — without a session there's no session.user.email to derive it from. */
  readonly accountLabel: string;
  readonly title?: string;
  readonly subtitle?: ReactNode;
  /** Fired once confirm succeeds — the caller owns session refresh, see the
   *  file-level comment above. */
  readonly onSuccess?: () => void;
  readonly onCancel?: () => void;
};

export function MfaSetupPreauthScreen({
  preauthSetupToken,
  accountLabel,
  title,
  subtitle,
  onSuccess,
  onCancel,
}: MfaSetupPreauthScreenProps): ReactNode {
  const t = useTranslation();
  const { Button, Banner, Field, Form, Input, Section } = usePrimitives();

  const [setup, setSetup] = useState<SetupState | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startSetup = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await startMfaSetupPreauth(preauthSetupToken, accountLabel);
      if (res.kind !== "success") {
        setError(res.error.reason);
        return;
      }
      // errorCorrectionLevel "H" (~30% redundancy) — more resilient to
      // camera/lighting issues than the default, no downside for a code
      // this short-lived.
      const qrSvg = await QRCode.toString(res.data.otpauthUri, {
        type: "svg",
        errorCorrectionLevel: "H",
      });
      setSetup({
        setupToken: res.data.setupToken,
        secretParam: extractSecret(res.data.otpauthUri),
        recoveryCodes: res.data.recoveryCodes,
        qrSvg,
      });
      setAcknowledged(false);
      setCode("");
    } catch {
      setError("setup_failed");
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async (): Promise<void> => {
    if (!setup) return;
    setBusy(true);
    setError(null);
    try {
      const res = await confirmMfaSetupPreauth(setup.setupToken, code);
      if (res.kind !== "success") {
        setError(res.error.reason);
        return;
      }
      onSuccess?.();
    } catch {
      setError("setup_failed");
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e?: FormEvent): void => {
    e?.preventDefault();
    void confirmSetup();
  };

  return (
    <AuthCard
      title={title ?? t("auth.mfa.setup.title")}
      subtitle={subtitle ?? t("auth.mfa.setup.subtitle")}
    >
      <div className="p-6 pt-0 flex flex-col gap-4">
        {error !== null ? <Banner variant="error">{t(reasonToKey(error))}</Banner> : null}

        {!setup && (
          <Section
            testId="mfa-setup-preauth-intro"
            actions={
              <Button
                variant="primary"
                onClick={() => void startSetup()}
                loading={busy}
                disabled={busy}
              >
                {t("auth.mfa.setup.start")}
              </Button>
            }
          >
            <span className="text-sm text-muted-foreground">{t("auth.mfa.setup.intro")}</span>
          </Section>
        )}

        {setup && (
          <Form onSubmit={onSubmit}>
            <Section
              testId="mfa-setup-preauth-setup"
              actions={
                <Button
                  type="submit"
                  variant="primary"
                  loading={busy}
                  disabled={busy || !acknowledged || code.length < 6}
                >
                  {t("auth.mfa.setup.confirm")}
                </Button>
              }
            >
              <div className="flex flex-col items-center gap-2 text-center">
                <span className="text-sm font-semibold">{t("auth.mfa.enable.scanTitle")}</span>
                {/* qrcode's own SVG string output, not user input — safe to inline */}
                <div
                  className="h-40 w-40"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: qrcode-generated SVG, no user input
                  dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
                />
                <span className="text-xs text-muted-foreground">
                  {t("auth.mfa.enable.manualEntry")}
                </span>
                <code className="inline-block break-all rounded bg-muted px-3 py-2 font-mono text-sm">
                  {setup.secretParam}
                </code>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold">{t("auth.mfa.enable.recoveryTitle")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("auth.mfa.enable.recoveryHint")}
                </span>
                <code className="block whitespace-pre-wrap break-all rounded bg-muted px-3 py-2 font-mono text-sm">
                  {setup.recoveryCodes.join("\n")}
                </code>
                <Field id="mfa-setup-preauth-ack" label={t("auth.mfa.enable.acknowledge")}>
                  <Input
                    kind="boolean"
                    id="mfa-setup-preauth-ack"
                    name="mfa-setup-preauth-ack"
                    value={acknowledged}
                    onChange={setAcknowledged}
                  />
                </Field>
              </div>

              <Field id="mfa-setup-preauth-code" label={t("auth.mfa.enable.code")} required>
                <Input
                  kind="text"
                  id="mfa-setup-preauth-code"
                  name="mfa-setup-preauth-code"
                  value={code}
                  onChange={setCode}
                  disabled={busy || !acknowledged}
                  autoComplete="one-time-code"
                />
              </Field>
            </Section>
          </Form>
        )}

        {onCancel ? (
          <div className="flex justify-center">
            <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
              {t("auth.mfa.verify.backToLogin")}
            </Button>
          </div>
        ) : null}
      </div>
    </AuthCard>
  );
}
