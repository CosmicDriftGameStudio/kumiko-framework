import type { ReactNode } from "react";

/** One revealed value on a `secretMint` screen's confirm phase. */
export type SecretRevealValue = {
  readonly label: string;
  readonly value: string;
  readonly copyable: boolean;
  readonly multiline: boolean;
  /** Render `value` as a scannable QR code instead of monospaced text — for
   *  an otpauth://-style enrollment URI. Platforms without a QR-capable
   *  SecretReveal primitive fall back to the monospaced display. */
  readonly qr?: boolean;
};

/** One-time secret reveal — mint-form confirm phase. Renders each value
 *  monospaced (multiline splits it one line per entry, for recovery codes),
 *  with a per-value copy control when `copyable`. */
export type SecretRevealProps = {
  readonly values: readonly SecretRevealValue[];
  readonly copyLabel: string;
  readonly copiedLabel: string;
  readonly testId?: string;
};

/** Thumb-reach action row for custom screens: pinned to the bottom edge on
 *  narrow viewports (above the device's safe-area inset), inline otherwise.
 *  `children` are the forward actions and share the remaining width; `back`
 *  renders an icon-only back control in front of them. */
export type StickyActionBarProps = {
  readonly children: ReactNode;
  readonly back?: { readonly onBack: () => void; readonly label: string };
  readonly testId?: string;
};

/** Copies `text` to the clipboard; the label flips to `copiedLabel` once
 *  the platform confirmed the write. */
export type CopyButtonProps = {
  readonly text: string;
  readonly label: string;
  readonly copiedLabel: string;
  readonly variant?: "primary" | "secondary";
  /** Layout extras, merged via cn(). */
  readonly className?: string;
  readonly testId?: string;
};

/** Hands `text` to another app. "whatsapp" opens a WhatsApp chat prefilled
 *  with the text (to `phone` when given, otherwise the contact picker);
 *  "system" opens the platform share sheet and renders nothing where the
 *  platform has none. */
export type ShareButtonProps = {
  readonly text: string;
  readonly label: string;
  readonly variant?: "primary" | "secondary";
  /** Layout extras, merged via cn(). */
  readonly className?: string;
  readonly testId?: string;
} & (
  | { readonly target: "whatsapp"; readonly phone?: string }
  | { readonly target: "system"; readonly title?: string; readonly url?: string }
);

export type PromoPanelAction =
  | { readonly label: string; readonly href: string; readonly testId?: string }
  | { readonly label: string; readonly onClick: () => void; readonly testId?: string };

/** Offer surface for upsells (e.g. "create an account"): its own tinted
 *  panel with eyebrow, headline, benefit content and one call to action, so
 *  an offer never reads like an info or error banner. */
export type PromoPanelProps = {
  readonly title: string;
  readonly eyebrow?: string;
  readonly children?: ReactNode;
  readonly action?: PromoPanelAction;
  readonly testId?: string;
};
