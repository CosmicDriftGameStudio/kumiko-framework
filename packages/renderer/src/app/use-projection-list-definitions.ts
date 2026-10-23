import type { ProjectionListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { useMemo } from "react";
import type { useUserRoles } from "../context/user-roles-context.tsx";
import type { useAppFeatures } from "./app-features-context.tsx";
import { synthesizeProjectionEntity, synthesizeProjectionScreen } from "./projection-list-shim.ts";
import { findEditScreenFor } from "./screen-access.ts";

export function useProjectionListDefinitions(
  screen: ProjectionListScreenDefinition,
  appFeatures: ReturnType<typeof useAppFeatures>,
  userRoles: ReturnType<typeof useUserRoles>,
) {
  const defaultEditScreen = useMemo(() => {
    const detailFor = screen.detailFor;
    // skip: no detail screen declared, so rows get no default edit action
    if (detailFor === undefined) return undefined;
    return findEditScreenFor(detailFor, appFeatures, userRoles);
  }, [appFeatures, screen.detailFor, userRoles]);

  // searchable/sortable/paginated are derived at buildAppSchema time from the
  // query handler's Zod schema — not authored on the screen.
  const searchable = screen.searchable ?? false;
  const sortable = screen.sortable ?? false;
  const paginated = screen.paginated ?? false;
  const entity = useMemo(
    () => synthesizeProjectionEntity(screen.columns, sortable),
    [screen.columns, sortable],
  );
  const listScreen = useMemo(() => synthesizeProjectionScreen(screen), [screen]);
  return { defaultEditScreen, searchable, sortable, paginated, entity, listScreen };
}
