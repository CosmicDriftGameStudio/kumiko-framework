// @runtime client
// MfaEnableScreen — logged-in self-service TOTP-Enrollment. Kein Dialog:
// DefaultDialog schließt nach JEDEM onConfirm (siehe renderer-web/src/
// primitives/dialog.tsx — onOpenChange(false) im finally-Block), das passt
// nicht zu einem Mehrschritt-Flow (Secret zeigen → Recovery-Codes zeigen →
// Code bestätigen). Folgt stattdessen pat-tokens-screen.tsx's embedded-
// Screen-Konvention: Feature registriert das dormant via r.screen, App
// platziert es via r.nav.

import { useDispatcher, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { FormScreenShell } from "@cosmicdrift/kumiko-renderer-web";
import QRCode from "qrcode";
import { type ReactNode, useState } from "react";
// kumiko-lint-ignore cross-feature-import client-only hook, the feature's server barrel has no web/ re-export
import { useSession } from "../../auth-email-password/web";
import { AuthMfaHandlers } from "../constants";

type EnableStartResponse = {
  readonly setupToken: string;
  readonly otpauthUri: string;
  readonly recoveryCodes: readonly string[];
};

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

export type MfaEnableScreenProps = { readonly embedded?: boolean };

export function MfaEnableScreen({ embedded = false }: MfaEnableScreenProps = {}): ReactNode {
  const t = useTranslation();
  const { Button, Banner, Field, Input, Section, Heading } = usePrimitives();
  const dispatcher = useDispatcher();
  const session = useSession();

  const [setup, setSetup] = useState<SetupState | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);

  const startSetup = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const res = await dispatcher.write<EnableStartResponse>(AuthMfaHandlers.enableStart, {
      accountLabel: session.user?.email ?? "",
    });
    if (!res.isSuccess) {
      setBusy(false);
      setError(res.error.code);
      return;
    }
    const qrSvg = await QRCode.toString(res.data.otpauthUri, { type: "svg" });
    setBusy(false);
    setSetup({
      setupToken: res.data.setupToken,
      secretParam: extractSecret(res.data.otpauthUri),
      recoveryCodes: res.data.recoveryCodes,
      qrSvg,
    });
    setAcknowledged(false);
    setCode("");
  };

  const confirmSetup = async (): Promise<void> => {
    if (!setup) return;
    setBusy(true);
    setError(null);
    const res = await dispatcher.write(AuthMfaHandlers.enableConfirm, {
      setupToken: setup.setupToken,
      code,
    });
    setBusy(false);
    if (!res.isSuccess) {
      setError(res.error.code);
      return;
    }
    setEnabled(true);
    setSetup(null);
  };

  const content = (
    <div className="flex flex-col gap-6">
      <Heading>{t("auth.mfa.enable.title")}</Heading>

      {enabled && <Banner variant="info">{t("auth.mfa.enable.success")}</Banner>}
      {error !== null && <Banner variant="error">{t(`auth.mfa.errors.${error}`)}</Banner>}

      {!setup && !enabled && (
        <Section
          testId="mfa-enable-intro"
          actions={
            <Button
              variant="primary"
              onClick={() => void startSetup()}
              loading={busy}
              disabled={busy}
            >
              {t("auth.mfa.enable.start")}
            </Button>
          }
        >
          <span className="text-sm text-muted-foreground">{t("auth.mfa.enable.intro")}</span>
        </Section>
      )}

      {setup && (
        <Section
          testId="mfa-enable-setup"
          actions={
            <>
              <Button variant="secondary" onClick={() => setSetup(null)} disabled={busy}>
                {t("auth.mfa.enable.cancel")}
              </Button>
              <Button
                variant="primary"
                onClick={() => void confirmSetup()}
                loading={busy}
                disabled={busy || !acknowledged || code.length < 6}
              >
                {t("auth.mfa.enable.confirm")}
              </Button>
            </>
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
            <Field id="mfa-enable-ack" label={t("auth.mfa.enable.acknowledge")}>
              <Input
                kind="boolean"
                id="mfa-enable-ack"
                name="mfa-enable-ack"
                value={acknowledged}
                onChange={setAcknowledged}
              />
            </Field>
          </div>

          <Field id="mfa-enable-code" label={t("auth.mfa.enable.code")} required>
            <Input
              kind="text"
              id="mfa-enable-code"
              name="mfa-enable-code"
              value={code}
              onChange={setCode}
              disabled={busy || !acknowledged}
              autoComplete="one-time-code"
            />
          </Field>
        </Section>
      )}
    </div>
  );

  if (embedded) return content;
  return (
    <FormScreenShell testId="mfa-enable-screen" maxWidth="3xl">
      {content}
    </FormScreenShell>
  );
}
