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
// qrcode's package.json#browser remap avoids Node-only deps (yargs/pngjs)
// for bundlers that honor it — Metro doesn't, hence the explicit subpath.
// @types/qrcode only covers the main "qrcode" entry, not this subpath, and
// TypeScript can't auto-discover an ambient .d.ts sibling from inside a
// node_modules package (consuming apps typecheck this raw .tsx source).
// Apps mounting MfaEnableScreen need their own local ambient shim — see
// qrcode-browser.d.ts in this directory for the declaration to copy.
import QRCode from "qrcode/lib/browser";
import { type ReactNode, useState } from "react";
// kumiko-lint-ignore cross-feature-import client-only hook, the feature's server barrel has no web/ re-export
import { useSession } from "../../auth-email-password/web";
import { AuthMfaHandlers } from "../constants";
import { mfaManageErrorKey } from "./mfa-error-keys";

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

// 24x24 viewBox icon paths (Material-style), solid fill. Real SVG paths
// instead of emoji glyphs — emoji-as-<text> renders inconsistently across
// font stacks and never centers cleanly (font-specific glyph padding).
const QR_ICONS = [
  `<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="#ef4444"/>`,
  `<path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" fill="#facc15"/>`,
  `<circle cx="12" cy="12" r="11" fill="#facc15"/><circle cx="8.5" cy="10" r="1.4" fill="#1f2937"/><circle cx="15.5" cy="10" r="1.4" fill="#1f2937"/><path d="M7 14c1 2.2 3 3.4 5 3.4s4-1.2 5-3.4" stroke="#1f2937" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
];

// Overlay a random icon in a circle badge over the QR center. cx/cy/r
// percentages resolve against the SVG viewport regardless of viewBox size,
// so this string-injection works without parsing qrcode's output dimensions.
function withIconBadge(svg: string): string {
  const icon = QR_ICONS[Math.floor(Math.random() * QR_ICONS.length)];
  const size = Number(svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) /)?.[1] ?? 100);
  const r = size * 0.16;
  const iconSize = r * 1.3;
  const scale = iconSize / 24;
  const offset = size / 2 - iconSize / 2;
  // html-ok: icon is one of the fixed QR_ICONS literals above, not user input
  const badge = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="#fff" stroke="#e5e7eb" stroke-width="${size * 0.01}"/><g transform="translate(${offset} ${offset}) scale(${scale})">${icon}</g>`;
  return svg.replace("</svg>", `${badge}</svg>`);
}

export type MfaEnableScreenProps = {
  readonly embedded?: boolean;
  // Fired once enable-confirm succeeds — MfaEnableScreen has no query of its
  // own to invalidate, so a host screen composing it alongside other MFA
  // state (e.g. a status query gating which section renders) needs this to
  // know when to refetch/swap views instead of leaving the success banner
  // as a dead end.
  readonly onEnabled?: () => void;
};

export function MfaEnableScreen({
  embedded = false,
  onEnabled,
}: MfaEnableScreenProps = {}): ReactNode {
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
    try {
      const res = await dispatcher.write<EnableStartResponse>(AuthMfaHandlers.enableStart, {
        accountLabel: session.user?.email ?? "",
      });
      if (!res.isSuccess) {
        setError(res.error.code);
        return;
      }
      // errorCorrectionLevel "H" (~30% redundancy) so the icon badge overlay
      // doesn't break scanning.
      const qrSvg = withIconBadge(
        await QRCode.toString(res.data.otpauthUri, { type: "svg", errorCorrectionLevel: "H" }),
      );
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
      const res = await dispatcher.write(AuthMfaHandlers.enableConfirm, {
        setupToken: setup.setupToken,
        code,
      });
      if (!res.isSuccess) {
        setError(res.error.code);
        return;
      }
      setEnabled(true);
      setSetup(null);
      onEnabled?.();
    } catch {
      setError("setup_failed");
    } finally {
      setBusy(false);
    }
  };

  const content = (
    <div className="flex flex-col gap-6">
      <Heading>{t("auth.mfa.enable.title")}</Heading>

      {enabled && <Banner variant="info">{t("auth.mfa.enable.success")}</Banner>}
      {error !== null && <Banner variant="error">{t(mfaManageErrorKey(error))}</Banner>}

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
