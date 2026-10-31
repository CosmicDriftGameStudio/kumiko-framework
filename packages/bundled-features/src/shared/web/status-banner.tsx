import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";

export type SectionStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; messageKey: string }
  | { kind: "error"; messageKey: string };

export function StatusBanner({ status }: { readonly status: SectionStatus }): ReactNode {
  const t = useTranslation();
  const { Banner } = usePrimitives();
  if (status.kind === "success") {
    return <Banner variant="info">{t(status.messageKey)}</Banner>;
  }
  if (status.kind === "error") {
    return <Banner variant="error">{t(status.messageKey)}</Banner>;
  }
  return null;
}
