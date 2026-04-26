import { useToast } from "@kumiko/renderer-web";
import { type ReactNode, useState } from "react";
import { DemoPage, DemoSection } from "../components/page";

// Toast-Demo. useToast() ist die einzige Public-API — der ToastProvider
// ist im createKumikoApp gemountet, jeder Component innerhalb darf
// toasts pushen ohne sich um State/Mounting zu kümmern.

export function ToastDemo(): ReactNode {
  const { toast } = useToast();
  const [counter, setCounter] = useState(0);

  return (
    <DemoPage
      title="Toast"
      description="Auto-dismissende Notifications via @radix-ui/react-toast. Zwei Variants (default / destructive), optional description. Swipe-to-dismiss + 5s Auto-close."
    >
      <DemoSection title="Default-Variant">
        <button
          type="button"
          onClick={() =>
            toast({
              title: "Gespeichert",
              description: "Änderungen wurden persistiert.",
            })
          }
          className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Default-Toast triggern
        </button>
      </DemoSection>

      <DemoSection title="Destructive-Variant (Fehler)">
        <button
          type="button"
          onClick={() =>
            toast({
              title: "Fehler beim Speichern",
              description: "Network-Timeout. Bitte erneut versuchen.",
              variant: "destructive",
            })
          }
          className="inline-flex h-9 items-center justify-center rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
        >
          Error-Toast triggern
        </button>
      </DemoSection>

      <DemoSection title="Stacking — mehrere Toasts gleichzeitig">
        <button
          type="button"
          onClick={() => {
            const next = counter + 1;
            setCounter(next);
            toast({
              title: `Toast #${next}`,
              description: "Mehrere Toasts stapeln vertikal — pro Toast eigene Auto-dismiss-Timer.",
            });
          }}
          className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent"
        >
          Toast #{counter + 1} hinzufügen
        </button>
      </DemoSection>

      <DemoSection title="Nur Title (ohne Description)">
        <button
          type="button"
          onClick={() => toast({ title: "Kopiert" })}
          className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent"
        >
          Mini-Toast triggern
        </button>
      </DemoSection>
    </DemoPage>
  );
}
