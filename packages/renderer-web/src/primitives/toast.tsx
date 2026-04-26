// Toast-Primitive auf @radix-ui/react-toast. Ein globaler Provider
// + ein useToast()-Hook der von überall in der App aus Toasts auslösen
// kann. Kein Context-Boilerplate für Konsumenten — der Hook returned
// einen `toast()`-Trigger, mehr Public-API gibt's nicht.
//
// Variants: "default" (neutral) und "destructive" (Fehler-Akzent).
// Auto-dismiss nach 5s, manuell schließbar via X-Button. Der ARIA-
// Live-Region-Setup kommt komplett aus Radix.

import * as Primitive from "@radix-ui/react-toast";
import { X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
} from "react";
import { cn } from "../lib/cn";

export type ToastVariant = "default" | "destructive";

export type ToastOptions = {
  readonly title: string;
  readonly description?: string;
  readonly variant?: ToastVariant;
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
    // Nicht throwen — Tests die einen Component ohne Provider rendern
    // sollen nicht crashen. No-op statt fehlerhaftes Mount.
    return { toast: () => undefined };
  }
  return ctx;
}

export type ToastProviderProps = {
  readonly children: ReactNode;
};

export function ToastProvider({ children }: ToastProviderProps): ReactNode {
  const [entries, setEntries] = useState<readonly ToastEntry[]>([]);
  // Counter für deterministische IDs — Date.now()-basiert würde bei
  // 2-Toasts-im-selben-Tick kollidieren.
  const idPrefix = useId();
  const [counter, setCounter] = useState(0);

  const toast = useCallback(
    (opts: ToastOptions) => {
      setCounter((c) => c + 1);
      setEntries((current) => [...current, { ...opts, id: `${idPrefix}-${counter}` }]);
    },
    [counter, idPrefix],
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
            "fixed top-0 right-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4",
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

function ToastItem({
  entry,
  onClose,
}: {
  readonly entry: ToastEntry;
  readonly onClose: () => void;
}): ReactNode {
  const variantClass =
    entry.variant === "destructive"
      ? "destructive group border-destructive bg-destructive text-destructive-foreground"
      : "border bg-background text-foreground";
  return (
    <Primitive.Root
      className={cn(rootClass, variantClass)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <div className="grid gap-1">
        <Primitive.Title className="text-sm font-semibold">{entry.title}</Primitive.Title>
        {entry.description !== undefined && (
          <Primitive.Description className="text-sm opacity-90">
            {entry.description}
          </Primitive.Description>
        )}
      </div>
      <Primitive.Close
        className={cn(
          "absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity",
          "hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-1",
          "group-hover:opacity-100",
          "group-[.destructive]:text-red-300 group-[.destructive]:hover:text-red-50",
        )}
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </Primitive.Close>
    </Primitive.Root>
  );
}
