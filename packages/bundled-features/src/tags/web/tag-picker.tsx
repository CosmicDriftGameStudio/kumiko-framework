// @runtime client
// TagPicker — the shared "manage + pick labels" modal. Wraps TagManager in
// select-mode inside a Dialog: the user can create/recolor/delete labels (those
// hit the catalog immediately) and toggle which ones apply (buffered). On
// confirm ("Done") the chosen ids are handed back to the caller via onChange;
// Cancel/✕ discards the selection (catalog edits stay). Scope-filtered to the
// caller's entityType so only global + matching labels are offered.

import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useEffect, useState } from "react";
import { TagManager } from "./tag-manager";

export function TagPicker({
  entityType,
  value,
  onChange,
  open,
  onOpenChange,
}: {
  readonly entityType?: string;
  readonly value: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactNode {
  const { Dialog } = usePrimitives();
  const t = useTranslation();
  const [buffer, setBuffer] = useState<readonly string[]>(value);
  // Reset the buffer to the caller's truth every time the modal (re)opens.
  useEffect(() => {
    if (open) setBuffer(value);
  }, [open, value]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("tags.picker.title")}
      confirmLabel={t("tags.picker.done")}
      onConfirm={async () => {
        onChange(buffer);
      }}
      testId="tag-picker-dialog"
    >
      <TagManager
        {...(entityType !== undefined && { entityType })}
        selection={{ value: buffer, onChange: setBuffer }}
      />
    </Dialog>
  );
}
