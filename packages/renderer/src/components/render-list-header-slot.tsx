import type { EntityListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useEffect } from "react";
import { extensionSectionName, useExtensionSectionComponent } from "../app/extension-sections.tsx";
import { rendererWarn } from "../dev-console.ts";

// Header slot in the list toolbar (toolbarEnd): `screen.slots.header` is
// a PlatformComponent (`{ react: { __component: "X" } }`) resolved through
// the same ExtensionSectionsProvider registry as entityEdit sections.
// entityId is null in the list context because there is no row; the component
// loads its own data (for example, a cap counter from a usage query). A
// separate component is required by the Rules of Hooks because
// useExtensionSectionComponent must not run conditionally in RenderList.
export function ListHeaderSlotMount({
  screen,
}: {
  readonly screen: EntityListScreenDefinition;
}): ReactNode {
  const header = screen.slots?.header;
  const name = header !== undefined ? extensionSectionName(header) : undefined;
  const Component = useExtensionSectionComponent(name);
  // A declared-but-unregistered header slot renders nothing; warn so the author
  // finds the typo / missing clientFeatures.extensionSectionComponents entry,
  // mirroring the diagnostic banner in render-edit's ExtensionSectionMount
  // (the toolbar has no room for a banner, so a dev-warn it is).
  useEffect(() => {
    if (name !== undefined && Component === undefined) {
      rendererWarn(
        `[kumiko] List header slot component "${name}" on screen "${screen.id}" is not registered in clientFeatures.extensionSectionComponents — the header slot renders nothing.`,
      );
    }
  }, [name, Component, screen.id]);
  if (Component === undefined) return null;
  // screenId lets a header control drive this list's URL-filter state
  // (useListUrlState) — e.g. a tag filter narrowing the list to an id-set.
  return <Component entityName={screen.entity} entityId={null} screenId={screen.id} />;
}
