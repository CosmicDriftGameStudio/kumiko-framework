import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { DemoPage, DemoSection } from "../components/page";

export function DialogDemo(): ReactNode {
  const { Button, Dialog, Lightbox, Text } = usePrimitives();
  const [defaultOpen, setDefaultOpen] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [asyncOpen, setAsyncOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [confirmedAction, setConfirmedAction] = useState<string>("(noch nichts bestätigt)");

  return (
    <DemoPage
      title="Dialog & Lightbox"
      description="Dialog für Bestätigungen; Lightbox für Vollbild-Bildvorschau. Beide teilen dieselbe Radix-Overlay-Shell (Focus-Trap, Esc, Backdrop-Click)."
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

      <DemoSection title="Lightbox">
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          className="cursor-zoom-in overflow-hidden rounded-lg border border-border shadow-sm"
          data-testid="lightbox-trigger"
        >
          <img
            src="/screenshots/hero-app.png"
            alt="Tasklane planning board — click to enlarge"
            className="block h-auto w-full max-w-md"
          />
        </button>
        <Text variant="small">Klick auf das Bild öffnet die Vollbild-Vorschau.</Text>
        <Lightbox
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
          src="/screenshots/hero-app.png"
          alt="Tasklane planning board — click to enlarge"
          testId="lightbox-demo"
        />
      </DemoSection>
    </DemoPage>
  );
}
