import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import { useToast } from "@cosmicdrift/kumiko-renderer-web";
import { type ReactNode, useState } from "react";
import { DemoPage, DemoSection } from "../components/page";

// Toast-Demo. useToast() ist die einzige Public-API — der ToastProvider
// ist im createKumikoApp gemountet, jeder Component innerhalb darf
// toasts pushen ohne sich um State/Mounting zu kümmern.

export function ToastDemo(): ReactNode {
  const { toast } = useToast();
  const { Button } = usePrimitives();
  const [counter, setCounter] = useState(0);

  return (
    <DemoPage
      title="Toast"
      description="Auto-dismissende Notifications via @radix-ui/react-toast. Zwei Variants (default / bad), optional description. Swipe-to-dismiss + 5s Auto-close."
    >
      <DemoSection title="Default-Variant">
        <Button
          onClick={() =>
            toast({
              title: "Gespeichert",
              description: "Änderungen wurden persistiert.",
            })
          }
        >
          Default-Toast triggern
        </Button>
      </DemoSection>

      <DemoSection title="Destructive-Variant (Fehler)">
        <Button
          variant="danger"
          onClick={() =>
            toast({
              title: "Fehler beim Speichern",
              description: "Network-Timeout. Bitte erneut versuchen.",
              variant: "bad",
            })
          }
        >
          Error-Toast triggern
        </Button>
      </DemoSection>

      <DemoSection title="Stacking — mehrere Toasts gleichzeitig">
        <Button
          variant="secondary"
          onClick={() => {
            const next = counter + 1;
            setCounter(next);
            toast({
              title: `Toast #${next}`,
              description: "Mehrere Toasts stapeln vertikal — pro Toast eigene Auto-dismiss-Timer.",
            });
          }}
        >
          Toast #{counter + 1} hinzufügen
        </Button>
      </DemoSection>

      <DemoSection title="Nur Title (ohne Description)">
        <Button variant="secondary" onClick={() => toast({ title: "Kopiert" })}>
          Mini-Toast triggern
        </Button>
      </DemoSection>
    </DemoPage>
  );
}
