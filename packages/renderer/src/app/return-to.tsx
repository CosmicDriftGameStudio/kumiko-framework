import type { ScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useUserRoles } from "../context/user-roles-context";
import { useAppFeatures } from "./app-features-context";
import type { FeatureSchema } from "./feature-schema";
import { type NavApi, type ScreenTarget, useNav } from "./nav";
import { lastSegment } from "./qn";
import { screenAccessAllows } from "./screen-access";

// A search param, not nav/route state, so it survives a full page reload
// and a copied/shared URL.
export const RETURN_TO_PARAM = "returnTo";

export type ReturnHost = {
  readonly screenId: string;
  readonly entityId?: string;
};

export function formatReturnTo(host: ReturnHost): string {
  return host.entityId !== undefined ? `${host.screenId}/${host.entityId}` : host.screenId;
}

// {} when target IS host — pushPath no-ops on the same path, so the param
// would land on the current page instead of the one being left.
export function returnToParams(
  host: ReturnHost | undefined,
  target: ScreenTarget,
): Readonly<Record<string, string>> {
  if (host === undefined) return {};
  if (lastSegment(target.screenId) === host.screenId && target.entityId === host.entityId) {
    return {};
  }
  return { [RETURN_TO_PARAM]: formatReturnTo(host) };
}

export function navigateWithReturnTo(
  nav: NavApi,
  target: ScreenTarget,
  host: ReturnHost | undefined,
  params?: Readonly<Record<string, string | null>>,
): void {
  nav.navigate(target);
  const merged: Record<string, string | null> = {
    ...(params ?? {}),
    ...returnToParams(host, target),
  };
  if (Object.keys(merged).length > 0) {
    nav.setSearchParams(merged);
  }
}

// "%" is left alone — route entityIds come raw from the path and can carry it.
const UNSAFE_ENTITY_ID_PATTERN = /[\\?#\s]/;

// Every failure branch returns undefined so a malformed or stale value falls
// back to the caller's own default instead of throwing.
export function resolveReturnTarget(
  raw: string | undefined,
  ownScreenId: string,
  features: readonly FeatureSchema[],
  userRoles: readonly string[] | undefined,
): ScreenTarget | undefined {
  if (raw === undefined || raw === "") return undefined;
  const segments = raw.split("/");
  if (segments.length !== 1 && segments.length !== 2) return undefined;
  if (segments.some((segment) => segment === "")) return undefined;
  const [screenId, entityId] = segments;
  if (screenId === undefined || screenId.includes(":")) return undefined;
  if (screenId === lastSegment(ownScreenId)) return undefined;

  let matched: ScreenDefinition | undefined;
  for (const feature of features) {
    matched = feature.screens.find((s) => lastSegment(s.id) === screenId);
    if (matched !== undefined) break;
  }
  if (matched === undefined) return undefined;
  if (!screenAccessAllows(matched.access, userRoles)) return undefined;

  if (entityId !== undefined) {
    if (entityId === "." || entityId === "..") return undefined;
    if (UNSAFE_ENTITY_ID_PATTERN.test(entityId)) return undefined;
    let decodedEntityId: string;
    try {
      decodedEntityId = decodeURIComponent(entityId);
    } catch {
      return undefined;
    }
    if (decodedEntityId === "." || decodedEntityId === "..") return undefined;
    if (UNSAFE_ENTITY_ID_PATTERN.test(decodedEntityId) || decodedEntityId.includes("/")) {
      return undefined;
    }
    if (matched.type !== "entityEdit" && matched.type !== "projectionDetail") return undefined;
  }
  if (matched.type === "projectionDetail" && matched.singleton !== true && entityId === undefined) {
    return undefined;
  }

  return { screenId, ...(entityId !== undefined && { entityId }) };
}

const ReturnHostContext = createContext<ReturnHost | undefined>(undefined);

export function ReturnHostProvider({
  value,
  children,
}: {
  readonly value: ReturnHost;
  readonly children: ReactNode;
}): ReactNode {
  return <ReturnHostContext.Provider value={value}>{children}</ReturnHostContext.Provider>;
}

export function useReturnHost(): ReturnHost | undefined {
  return useContext(ReturnHostContext);
}

// Reads through useNav().searchParams (reactive), not a useState snapshot —
// a later setSearchParams call must not leave this stale.
export function useReturnTarget(ownScreenId: string): ScreenTarget | undefined {
  const nav = useNav();
  const features = useAppFeatures();
  const userRoles = useUserRoles();
  const raw = nav.searchParams[RETURN_TO_PARAM];
  return useMemo(
    () => resolveReturnTarget(raw, ownScreenId, features, userRoles),
    [raw, ownScreenId, features, userRoles],
  );
}
