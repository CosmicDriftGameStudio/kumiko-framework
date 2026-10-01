import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import { WandSparkles } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

const noop = (): void => {};

export function AssistantAction(): ReactNode {
  const { Dialog } = usePrimitives();
  const [open, setOpen] = useState(false);

  // Registered here on purpose: an overflow menu that unmounts this component
  // must visibly lose the shortcut.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        data-testid="assistant-action"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-accent"
      >
        <WandSparkles className="h-4 w-4" aria-hidden="true" />
        Assistent
        <kbd className="rounded border border-border px-1 font-sans text-xs text-muted-foreground">
          ⌘K
        </kbd>
      </button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Assistent"
        description="Der Assistent ist im Walkthrough nicht angebunden."
        confirmLabel="Schließen"
        onConfirm={noop}
        testId="assistant-dialog"
      />
    </>
  );
}
