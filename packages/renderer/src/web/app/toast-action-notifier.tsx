import { type ReactNode, useCallback } from "react";
import { type ActionNotice, ActionNoticeProvider, useTranslation } from "../../index.ts";
import { useToast } from "../primitives/toast.tsx";

/** Shows client-action outcomes as toasts; mount inside the ToastProvider. */
export function ToastActionNotifier({ children }: { readonly children: ReactNode }): ReactNode {
  const { toast } = useToast();
  const t = useTranslation();
  const notify = useCallback(
    (notice: ActionNotice) => {
      if (notice.tone === "success") {
        toast({ title: notice.text, variant: "ok" });
        return;
      }
      toast({ title: t("kumiko.rowAction.failed"), description: notice.text, variant: "bad" });
    },
    [toast, t],
  );
  return <ActionNoticeProvider notify={notify}>{children}</ActionNoticeProvider>;
}
