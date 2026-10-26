// Toast primitive built on radix-ui Toast: a global provider and
// a useToast() hook for triggering toasts throughout the app. Consumers
// get only the `toast()` trigger, without Context boilerplate.
//
// Variant is StatusTone, using the same color family as StatusBadge;
// the default is "muted" (neutral). Toasts auto-dismiss after 5s and can
// be closed manually with the X button. Radix provides the ARIA live region.

import { X } from "lucide-react";
import { Toast as Primitive } from "radix-ui";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import type { StatusTone } from "../widgets/status-badge.tsx";
import { CopyButton } from "./share-actions.tsx";

export type ToastVariant = StatusTone;

export type ToastOptions = {
  readonly title: string;
  readonly description?: string;
  readonly variant?: ToastVariant;
  // Self-service deep link (for example, KumikoError.docsUrl). When set,
  // the toast renders a "Mehr erfahren →" link that opens in a new tab.
  // The label can be overridden with `docsLinkLabel` (default: i18n
  // kumiko.toast.learn-more).
  readonly docsUrl?: string;
  readonly docsLinkLabel?: string;
  readonly requestId?: string;
};

type ToastEntry = ToastOptions & {
  readonly id: string;
};

type ToastApi = {
  readonly toast: (opts: ToastOptions) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (ctx === null) {
    // Do not throw: tests rendering a component without a provider must not
    // crash. Use a no-op instead of failing the mount.
    return { toast: () => undefined };
  }
  return ctx;
}

export type ToastProviderProps = {
  readonly children: ReactNode;
};

export function ToastProvider({ children }: ToastProviderProps): ReactNode {
  const [entries, setEntries] = useState<readonly ToastEntry[]>([]);
  // A monotonically increasing useRef counter avoids a closure bug: two
  // toast() calls in the same tick would read the same stale useState value
  // and collide on the ID. The ref is synchronously mutable, so each call
  // receives a guaranteed-unique ID.
  const idPrefix = useId();
  const counterRef = useRef(0);

  const toast = useCallback(
    (opts: ToastOptions) => {
      counterRef.current += 1;
      const id = `${idPrefix}-${counterRef.current}`;
      setEntries((current) => [...current, { ...opts, id }]);
    },
    [idPrefix],
  );

  const api = useMemo<ToastApi>(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      <Primitive.Provider swipeDirection="right" duration={5000}>
        {children}
        {entries.map((entry) => (
          <ToastItem
            key={entry.id}
            entry={entry}
            onClose={() => setEntries((current) => current.filter((e) => e.id !== entry.id))}
          />
        ))}
        <Primitive.Viewport
          className={cn(
            "fixed top-0 right-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4",
            "sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]",
          )}
        />
      </Primitive.Provider>
    </ToastContext.Provider>
  );
}

const rootClass =
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-2 " +
  "overflow-hidden rounded-md border p-4 pr-6 shadow-lg transition-all " +
  "data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] " +
  "data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none " +
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out " +
  "data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full " +
  "data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full";

const TONE_CLASS: Record<StatusTone, string> = {
  ok: "border-status-ok/30 bg-status-ok/10 text-status-ok",
  warn: "border-status-warn/30 bg-status-warn/10 text-status-warn",
  bad: "border-status-bad/30 bg-status-bad/10 text-status-bad",
  critical: "border-status-critical/40 bg-status-critical/15 text-status-critical",
  muted: "border bg-background text-foreground",
};

function ToastErrorReference({ requestId }: { readonly requestId: string }): ReactNode {
  const t = useTranslation();
  const reference = t("kumiko.error.reference", { id: requestId });
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs"
      data-testid="toast-error-reference"
    >
      <span className="min-w-0 truncate whitespace-nowrap select-all opacity-90" title={reference}>
        {reference}
      </span>
      <CopyButton
        text={requestId}
        label={t("kumiko.error.copyReference")}
        copiedLabel={t("kumiko.error.referenceCopied")}
        variant="secondary"
        className="min-h-0 h-7 shrink-0"
        testId="toast-error-reference-copy"
      />
    </div>
  );
}

function ToastItem({
  entry,
  onClose,
}: {
  readonly entry: ToastEntry;
  readonly onClose: () => void;
}): ReactNode {
  const t = useTranslation();
  const learnMore = entry.docsLinkLabel ?? t("kumiko.toast.learn-more");
  const variantClass = TONE_CLASS[entry.variant ?? "muted"];
  return (
    <Primitive.Root
      className={cn(rootClass, variantClass)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <div className="grid min-w-0 gap-1">
        <Primitive.Title className="text-sm font-semibold">{entry.title}</Primitive.Title>
        {entry.description !== undefined && (
          <Primitive.Description className="text-sm opacity-90">
            {entry.description}
          </Primitive.Description>
        )}
        {entry.requestId !== undefined && <ToastErrorReference requestId={entry.requestId} />}
        {entry.docsUrl !== undefined && (
          <Primitive.Action altText={learnMore} asChild>
            <a
              href={entry.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "text-xs underline opacity-90 hover:opacity-100",
                "focus:outline-none focus:ring-1 focus:ring-current rounded",
              )}
            >
              {learnMore} →
            </a>
          </Primitive.Action>
        )}
      </div>
      <Primitive.Close
        className={cn(
          "absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity",
          "hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-1",
          "group-hover:opacity-100",
        )}
        aria-label={t("kumiko.dialog.close")}
      >
        <X className="h-4 w-4" />
      </Primitive.Close>
    </Primitive.Root>
  );
}
