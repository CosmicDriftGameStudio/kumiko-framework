import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";

export type LeaveTarget = { readonly kind: "locale"; readonly locale: string };

export type ConfirmDialog =
  | { readonly kind: "none" }
  | { readonly kind: "discard" }
  | { readonly kind: "remove"; readonly key: string }
  | { readonly kind: "leave"; readonly target: LeaveTarget };

export function MailConfirmDialogs({
  dialog,
  onClose,
  onDiscard,
  onRemove,
  onLeaveSave,
  onLeaveDiscard,
}: {
  readonly dialog: ConfirmDialog;
  readonly onClose: () => void;
  readonly onDiscard: () => void;
  readonly onRemove: (key: string) => Promise<void>;
  readonly onLeaveSave: (target: LeaveTarget) => Promise<void>;
  readonly onLeaveDiscard: (target: LeaveTarget) => void;
}): ReactNode {
  const t = useTranslation();
  const { Button, Dialog } = usePrimitives();
  const closeUnless = (open: boolean): void => {
    if (!open) onClose();
  };
  return (
    <>
      <Dialog
        open={dialog.kind === "discard"}
        onOpenChange={closeUnless}
        title={t("documentDesigner.mail.discard.title")}
        description={t("documentDesigner.mail.discard.description")}
        confirmLabel={t("documentDesigner.mail.discard.confirm")}
        variant="danger"
        testId="mail-discard-dialog"
        onConfirm={onDiscard}
      />
      <Dialog
        open={dialog.kind === "remove"}
        onOpenChange={closeUnless}
        title={t("documentDesigner.mail.remove.title")}
        description={t("documentDesigner.mail.remove.description")}
        confirmLabel={t("documentDesigner.mail.remove.confirm")}
        variant="danger"
        testId="mail-remove-dialog"
        onConfirm={() => (dialog.kind === "remove" ? onRemove(dialog.key) : Promise.resolve())}
      />
      <Dialog
        open={dialog.kind === "leave"}
        onOpenChange={closeUnless}
        title={t("documentDesigner.mail.leave.title")}
        description={t("documentDesigner.mail.leave.description")}
        confirmLabel={t("documentDesigner.mail.leave.save")}
        testId="mail-leave-dialog"
        onConfirm={() => (dialog.kind === "leave" ? onLeaveSave(dialog.target) : Promise.resolve())}
      >
        <Button
          variant="danger-ghost"
          onClick={() => {
            if (dialog.kind === "leave") onLeaveDiscard(dialog.target);
          }}
          testId="mail-leave-discard"
        >
          {t("documentDesigner.mail.leave.discard")}
        </Button>
      </Dialog>
    </>
  );
}
