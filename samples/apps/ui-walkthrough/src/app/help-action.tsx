import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import { Drawer } from "@cosmicdrift/kumiko-renderer/web";
import { CircleHelp } from "lucide-react";
import { type ReactNode, useState } from "react";

// A non-modal side panel: the screen behind stays usable and narrows instead of being covered.
export function HelpAction(): ReactNode {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid="help-action"
        aria-label={t("tasks.help.label")}
        aria-pressed={open}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex size-9 items-center justify-center rounded-md border border-border bg-card text-foreground hover:bg-accent"
      >
        <CircleHelp className="h-4 w-4" aria-hidden="true" />
      </button>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        side="right"
        modal={false}
        belowHeader
        width={360}
        title={t("tasks.help.label")}
        description={t("tasks.help.description")}
        testId="help-drawer"
      >
        <p className="py-2 text-sm text-muted-foreground">{t("tasks.help.body")}</p>
      </Drawer>
    </>
  );
}
