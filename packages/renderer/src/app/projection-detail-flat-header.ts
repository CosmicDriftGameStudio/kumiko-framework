import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";

/** A drawer-hosted detail with a `header` shows it as a flat block instead of a card, unless a custom header slot takes over. */
export function hasFlatDetailHeader(
  screen: Pick<ProjectionDetailScreenDefinition, "header" | "slots">,
): boolean {
  return screen.header !== undefined && screen.slots?.header === undefined;
}
