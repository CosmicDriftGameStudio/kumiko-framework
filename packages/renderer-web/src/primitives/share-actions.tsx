import type { CopyButtonProps, ShareButtonProps } from "@cosmicdrift/kumiko-renderer";
import { buildWhatsAppShareUrl } from "@cosmicdrift/kumiko-renderer";
import { Check, Copy, MessageCircle, Share2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "../lib/cn";
import { buttonVariants, Button as UiButton } from "../ui/button";

const COPIED_FEEDBACK_MS = 2000;

function uiVariantFor(variant: "primary" | "secondary" | undefined): "default" | "outline" {
  return variant === "primary" ? "default" : "outline";
}

export function CopyButton({
  text,
  label,
  copiedLabel,
  variant,
  className,
  testId,
}: CopyButtonProps): ReactNode {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copyText(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard denied (insecure context, permission) — the label simply
      // doesn't flip, so the user sees the copy did not happen.
    }
  }

  return (
    <UiButton
      type="button"
      variant={uiVariantFor(variant)}
      onClick={copyText}
      data-testid={testId}
      data-copied={copied ? "true" : undefined}
      className={cn("min-h-11", className)}
    >
      {copied ? (
        <Check aria-hidden="true" className="text-status-ok" />
      ) : (
        <Copy aria-hidden="true" />
      )}
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </UiButton>
  );
}

function hasSystemShareSheet(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

export function ShareButton(props: ShareButtonProps): ReactNode {
  const { text, label, variant, className, testId } = props;
  const classes = cn(buttonVariants({ variant: uiVariantFor(variant) }), "min-h-11", className);

  if (props.target === "whatsapp") {
    return (
      <a
        href={buildWhatsAppShareUrl(text, props.phone)}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={testId}
        className={classes}
      >
        <MessageCircle aria-hidden="true" />
        {label}
      </a>
    );
  }

  if (!hasSystemShareSheet()) return null;
  const { title, url } = props;
  async function openShareSheet(): Promise<void> {
    try {
      await navigator.share({
        text,
        ...(title !== undefined && { title }),
        ...(url !== undefined && { url }),
      });
    } catch {
      // AbortError when the user closes the sheet — nothing to report.
    }
  }
  return (
    <button type="button" onClick={openShareSheet} data-testid={testId} className={classes}>
      <Share2 aria-hidden="true" />
      {label}
    </button>
  );
}
