import type { ReactNode } from "react";
import type { Translate } from "../headless/index.ts";
import { usePrimitives } from "../primitives.tsx";

/** Keeps a stale or forbidden named filter removable while the list shows its error state. */
export function NamedFilterRemove({
  active,
  translate,
  onRemove,
}: {
  readonly active: boolean;
  readonly translate: Translate;
  readonly onRemove: () => void;
}): ReactNode {
  const { Button } = usePrimitives();
  if (!active) return null;
  return (
    <Button variant="secondary" onClick={onRemove} testId="named-filter-remove">
      {translate("kumiko.list.filter.reset")}
    </Button>
  );
}
