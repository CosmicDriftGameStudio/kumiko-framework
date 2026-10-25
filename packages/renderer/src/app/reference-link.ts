import { useCallback } from "react";
import { useUserRoles } from "../context/user-roles-context.tsx";
import type { CellLink } from "../headless/index.ts";
import { useAppFeatures } from "./app-features-context.tsx";
import { useOptionalNav } from "./nav.tsx";
import { lastSegment } from "./qn.ts";
import { navigateWithReturnTo, useReturnHost } from "./return-to.tsx";
import { navigateTargetAllows } from "./screen-access.ts";

/** Link to a referenced record's detail screen, or undefined when there is no
 *  navigation, the user may not open that screen, or no detail screen exists. */
export type ReferenceLinkResolver = (refEntity: string, id: string) => CellLink | undefined;

export function useReferenceLinkResolver(): ReferenceLinkResolver {
  const nav = useOptionalNav();
  const appFeatures = useAppFeatures();
  const userRoles = useUserRoles();
  const host = useReturnHost();
  return useCallback(
    (refEntity, id) => {
      if (nav === undefined || refEntity === "" || id === "") return undefined;
      if (!navigateTargetAllows({ entity: refEntity }, appFeatures, userRoles)) return undefined;
      const target = { entity: refEntity, id };
      // hrefFor throws for an entity without a detailFor screen; outside
      // createKumikoApp the feature list is empty, so the gate above can't
      // rule that out. The NavApi owns target resolution, so ask it.
      let href: string;
      try {
        href = nav.hrefFor(target);
      } catch {
        return undefined;
      }
      if (href === "") return undefined;
      return { href, onPress: () => navigateWithReturnTo(nav, target, host) };
    },
    [nav, appFeatures, userRoles, host],
  );
}

/** Link to a screen named by its QN, or undefined when there is no navigation
 *  or the user may not open that screen. */
export type ScreenLinkResolver = (screenQn: string) => CellLink | undefined;

export function useScreenLinkResolver(): ScreenLinkResolver {
  const nav = useOptionalNav();
  const appFeatures = useAppFeatures();
  const userRoles = useUserRoles();
  const host = useReturnHost();
  return useCallback(
    (screenQn) => {
      const screenId = lastSegment(screenQn);
      if (nav === undefined || screenId === "") return undefined;
      if (!navigateTargetAllows({ screen: screenId }, appFeatures, userRoles)) return undefined;
      const target = { screenId };
      return { href: nav.hrefFor(target), onPress: () => navigateWithReturnTo(nav, target, host) };
    },
    [nav, appFeatures, userRoles, host],
  );
}
