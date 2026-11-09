import type { ReactNode } from "react";
import { useOptionalTranslation } from "../i18n.tsx";

const keyAsText = (key: string): string => key;

// MultiSelectFieldDef's `display: "count"`: the held values are not listed, only how many there are.
export function MultiSelectCount({
  id,
  value,
}: {
  readonly id: string;
  readonly value: readonly string[];
}): ReactNode {
  const t = useOptionalTranslation() ?? keyAsText;
  return (
    <span id={id} data-testid={`${id}-count`} className="text-sm text-foreground">
      {t("kumiko.form.selection-count", { count: value.length })}
    </span>
  );
}
