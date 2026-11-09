import type { ReactNode } from "react";
import { useOptionalTranslation } from "../i18n.tsx";
import { usePrimitives } from "../primitives.tsx";

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
  const { Text } = usePrimitives();
  return (
    <Text variant="small" testId={`${id}-count`}>
      {t("kumiko.form.selection-count", { count: value.length })}
    </Text>
  );
}
