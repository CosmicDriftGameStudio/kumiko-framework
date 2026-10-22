import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useOptionalTranslation } from "../../../index.ts";
import { Button as UiButton } from "../../ui/button.tsx";

export function ResetAllButton({ onReset }: { readonly onReset: () => void }): ReactNode {
  const translate = useOptionalTranslation();
  return (
    <UiButton
      variant="ghost"
      size="sm"
      className="h-9 px-2"
      onClick={onReset}
      data-testid="list-reset-all"
    >
      {translate?.("kumiko.list.reset-all") ?? "Reset"}
      <X />
    </UiButton>
  );
}
