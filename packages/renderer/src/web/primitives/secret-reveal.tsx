/// <reference path="../qrcode-browser.d.ts" />
import { type ReactNode, useEffect, useState } from "react";
import type { SecretRevealProps } from "../../index.ts";
import { Button as UiButton } from "../ui/button.tsx";
import "../react-css-custom-properties.ts";

// otpauth:// enrollment URI → scannable QR (errorCorrectionLevel "H", ~30%
// redundancy — more resilient to camera/lighting issues than the default, no
// downside for a code this short-lived). Own component (not inline in
// values.map) because QRCode.toString is async — a hook inside .map would
// violate the rules of hooks.
function QrSecretValue({ value }: { readonly value: string }): ReactNode {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    // Loaded on first QR render, not with the primitives. The main entry pulls
    // Node-only deps (yargs/pngjs) under bundlers that ignore package.json#browser
    // (Metro), hence the explicit browser subpath.
    import("qrcode/lib/browser.js")
      .then(({ default: QRCode }) =>
        QRCode.toString(value, { type: "svg", errorCorrectionLevel: "H" }),
      )
      .then((result) => {
        if (!cancelled) setSvg(result);
      })
      .catch(() => {
        // A generic `qr` field may have no separate text display, so fall back to the plain value.
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);
  if (failed) {
    return (
      <code className="flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted px-3 py-2 font-mono text-sm">
        {value}
      </code>
    );
  }
  if (svg === null) return null;
  return (
    <div
      className="h-40 w-40"
      // qrcode's own SVG string output, not user input — safe to inline
      // biome-ignore lint/security/noDangerouslySetInnerHtml: qrcode-generated SVG, no user input
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// One-time secret reveal (fw#2548, secretMint confirm phase) — monospaced
// per-value display with a copy button that flips to `copiedLabel` on
// success. Silent-catch on clipboard error mirrors the copy-link pattern in
// create-app.tsx.
export function DefaultSecretReveal({
  values,
  copyLabel,
  copiedLabel,
  testId,
}: SecretRevealProps): ReactNode {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  // Labels are not unique per reveal; suffix repeats so React keys stay distinct.
  const seenLabels = new Map<string, number>();
  const rowKeys = values.map((v) => {
    const occurrence = seenLabels.get(v.label) ?? 0;
    seenLabels.set(v.label, occurrence + 1);
    return `${v.label}#${occurrence}`;
  });
  return (
    <div data-testid={testId} className="flex flex-col gap-3">
      {values.map((v, i) => (
        <div key={rowKeys[i]} className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-muted-foreground">{v.label}</span>
          <div className="flex items-start gap-2">
            {v.qr === true ? (
              <QrSecretValue value={v.value} />
            ) : v.multiline ? (
              <pre className="flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted px-3 py-2 font-mono text-sm">
                {v.value}
              </pre>
            ) : (
              <code className="flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted px-3 py-2 font-mono text-sm">
                {v.value}
              </code>
            )}
            {v.copyable && (
              <UiButton
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(v.value);
                    setCopiedIndex(i);
                  } catch {
                    // clipboard blocked (non-secure context) — no fallback UI needed here
                  }
                }}
              >
                {copiedIndex === i ? copiedLabel : copyLabel}
              </UiButton>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
