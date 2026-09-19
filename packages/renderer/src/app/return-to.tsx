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

// Screen levels one returnTo value may carry: the host itself plus its own
// nested chain. Beyond that the host's returnTo is left out of the snapshot.
const MAX_RETURN_DEPTH = 3;
// Serialized host snapshot longer than this is dropped whole — the bare
// target still resolves, only the restored state is lost.
const MAX_RETURN_STATE_LENGTH = 512;

const NO_RETURN_STATE: Readonly<Record<string, string>> = Object.freeze({});

export type ReturnHost = {
  readonly screenId: string;
  readonly entityId?: string;
};

export type ReturnTo = {
  readonly path: string;
  readonly state: Readonly<Record<string, string>>;
};

/** Splits `<screenId>[/<entityId>][?<host-params>]`. One `URLSearchParams`
 *  pass per nesting level — a deeper level stays encoded inside a value and
 *  is only decoded when that level is reached. */
export function splitReturnTo(raw: string): ReturnTo {
  const queryStart = raw.indexOf("?");
  if (queryStart === -1) return { path: raw, state: NO_RETURN_STATE };
  return {
    path: raw.slice(0, queryStart),
    state: Object.fromEntries(new URLSearchParams(raw.slice(queryStart + 1))),
  };
}

// Saturates at MAX_RETURN_DEPTH — callers only ask whether the cap is
// reached, and an unbounded walk would follow attacker-sized nesting.
function returnToDepth(raw: string): number {
  let depth = 1;
  let current = raw;
  while (depth < MAX_RETURN_DEPTH) {
    const nested = splitReturnTo(current).state[RETURN_TO_PARAM];
    if (nested === undefined) return depth;
    depth += 1;
    current = nested;
  }
  return depth;
}

// Both caps degrade to the pre-snapshot value instead of failing, so a value
// that hits one still navigates.
function returnStateSnapshot(hostParams: Readonly<Record<string, string>> | undefined): string {
  if (hostParams === undefined) return "";
  const snapshot = new URLSearchParams();
  for (const [key, value] of Object.entries(hostParams)) {
    if (value === "") continue;
    if (key === RETURN_TO_PARAM && returnToDepth(value) >= MAX_RETURN_DEPTH) continue;
    snapshot.set(key, value);
  }
  const serialized = snapshot.toString();
  return serialized.length > MAX_RETURN_STATE_LENGTH ? "" : serialized;
}

export function formatReturnTo(
  host: ReturnHost,
  hostParams?: Readonly<Record<string, string>>,
): string {
  const path = host.entityId !== undefined ? `${host.screenId}/${host.entityId}` : host.screenId;
  const state = returnStateSnapshot(hostParams);
  return state === "" ? path : `${path}?${state}`;
}

// {} when target IS host — pushPath no-ops on the same path, so the param
// would land on the current page instead of the one being left.
export function returnToParams(
  host: ReturnHost | undefined,
  target: ScreenTarget,
  hostParams?: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  if (host === undefined) return {};
  if (lastSegment(target.screenId) === host.screenId && target.entityId === host.entityId) {
    return {};
  }
  return { [RETURN_TO_PARAM]: formatReturnTo(host, hostParams) };
}

export function navigateWithReturnTo(
  nav: NavApi,
  target: ScreenTarget,
  host: ReturnHost | undefined,
  params?: Readonly<Record<string, string | null>>,
): void {
  // Snapshot before navigating — nav.searchParams still describes the host.
  const returnParams = returnToParams(host, target, nav.searchParams);
  nav.navigate(target);
  const merged: Record<string, string | null> = {
    ...(params ?? {}),
    ...returnParams,
  };
  if (Object.keys(merged).length > 0) {
    nav.setSearchParams(merged);
  }
}

/** Jumps back to an already-validated returnTo target and restores the host
 *  search params carried in the same value. The host's own returnTo travels
 *  with them, so a chain unwinds one level per jump. */
export function navigateToReturn(nav: NavApi, target: ScreenTarget): void {
  const raw = nav.searchParams[RETURN_TO_PARAM];
  const state = raw === undefined ? NO_RETURN_STATE : splitReturnTo(raw).state;
  nav.navigate(target);
  // The explicit null drops this screen's own returnTo on nav impls whose
  // navigate keeps the query.
  nav.setSearchParams({ ...state, [RETURN_TO_PARAM]: state[RETURN_TO_PARAM] ?? null });
}

export function navigateToReturnOr(
  nav: NavApi,
  target: ScreenTarget | undefined,
  fallback: () => void,
): void {
  if (target === undefined) {
    fallback();
    return;
  }
  navigateToReturn(nav, target);
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
  const segments = splitReturnTo(raw).path.split("/");
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
