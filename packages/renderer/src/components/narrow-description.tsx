import type { ReactNode } from "react";
import { usePrimitives } from "../primitives.tsx";

function NarrowDescription({
  description,
  descriptionNarrow,
}: {
  description: string;
  descriptionNarrow: string;
}): ReactNode {
  const { Text } = usePrimitives();
  return <Text narrow={descriptionNarrow}>{description}</Text>;
}

/** The full description from `sm` up, the short one on the phone. */
export function narrowAwareDescription(
  description: string | undefined,
  descriptionNarrow: string | undefined,
): ReactNode {
  if (description === undefined || descriptionNarrow === undefined) return description;
  return <NarrowDescription description={description} descriptionNarrow={descriptionNarrow} />;
}
