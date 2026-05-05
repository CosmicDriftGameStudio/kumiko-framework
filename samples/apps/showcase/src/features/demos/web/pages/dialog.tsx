import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { DemoPage, DemoSection } from "../components/page";

export function DialogDemo(): ReactNode {
  const { Button, Dialog, Text } = usePrimitives();
  const [defaultOpen, setDefaultOpen] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [asyncOpen, setAsyncOpen] = useState(false);
  const [confirmedAction, setConfirmedAction] = useState<string>("(noch nichts bestätigt)");

  return (
    <DemoPage
      title="Dialog"
      description="Modal-Dialog für Bestätigungen. Radix-basiert: Focus-Trap, Esc-Schließen, Overlay-Click. variant=danger markiert destruktive Bestätigungen visuell."
    >
      <DemoSection title="Default-Variant">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setDefaultOpen(true)}>Dialog öffnen</Button>
          <Text variant="small">Letzte Aktion: {confirmedAction}</Text>
        </div>
        <Dialog
          open={defaultOpen}
          onOpenChange={setDefaultOpen}
          title="Bist du dir sicher?"
          description="Diese Aktion sendet eine E-Mail an alle Kunden. Bitte vorher prüfen."
          onConfirm={() => setConfirmedAction("Default-Confirm")}
          testId="dialog-default"
        />
      </DemoSection>

      <DemoSection title="Danger-Variant">
        <Button variant="danger" onClick={() => setDangerOpen(true)}>
          Eintrag löschen…
        </Button>
        <Dialog
          open={dangerOpen}
          onOpenChange={setDangerOpen}
          title="Wirklich löschen?"
          description="Der Datensatz wird unwiderruflich entfernt. Diese Aktion kann nicht rückgängig gemacht werden."
          confirmLabel="Löschen"
          variant="danger"
          onConfirm={() => setConfirmedAction("Danger-Confirm (delete)")}
          testId="dialog-danger"
        />
      </DemoSection>

      <DemoSection title="Async onConfirm (Spinner)">
        <Button onClick={() => setAsyncOpen(true)}>Async-Dialog öffnen</Button>
        <Dialog
          open={asyncOpen}
          onOpenChange={setAsyncOpen}
          title="Speichern dauert kurz"
          description="onConfirm ist async (1.5s). Confirm-Button zeigt während der Promise-Resolution einen Spinner; Dialog schließt automatisch danach."
          onConfirm={async () => {
            await new Promise((r) => setTimeout(r, 1500));
            setConfirmedAction("Async-Confirm (1.5s)");
          }}
          testId="dialog-async"
        />
      </DemoSection>
    </DemoPage>
  );
}
