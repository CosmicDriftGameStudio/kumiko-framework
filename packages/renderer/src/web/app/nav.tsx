// Browser navigation implementation: HTML5 History + popstate subscription.
// Types, Context, and useNav live in the shared `@cosmicdrift/kumiko-renderer`; this
// file provides only the web-specific NavApi instance and the
// `<KumikoLink>` anchor component.
//
// Deliberately no createStore: the source of truth is `window.location.pathname`
// (external and able to change through replaceState outside our control).
// A store would either be a second source of truth (risking drift) or a
// tick counter (an anti-pattern—createStore is a state holder, not an
// event bus). A hand-rolled listener set is appropriate here: there are two
// notification triggers (our pushPath and the popstate event), so this is not
// generalizable.

import {
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useSyncExternalStore,
} from "react";
import {
  type FeatureSchema,
  formatPath,
  hasUnsavedInput,
  type NavApi,
  type NavigateOptions,
  type NavTarget,
  parsePath,
  requestLeave,
  resolveTarget,
  type ScreenTarget,
  useNav,
} from "../../index.ts";

// basePath allows the app to be mounted under a URL prefix
// (for example, `/admin`). The read path strips the prefix before parsePath;
// the write path prepends it before pushState/replaceState/href.
//
// If the URL is not under basePath (for example, /marketing/foo with
// basePath="/admin"), stripBasePath returns `undefined`—useBrowserNavApi then
// returns route=undefined, and the app renders its "outside" state
// (Not-Found, marketing layer, server-routing pickup, …). There is no
// automatic redirect to the app root—the host app decides.
function normalizeBasePath(raw: string | undefined): string {
  if (raw === undefined || raw === "" || raw === "/") return "";
  const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeading.endsWith("/") ? withLeading.slice(0, -1) : withLeading;
}

// Returns the in-app (basePath-relative) path when `path` is under basePath;
// otherwise returns `undefined`. The segment boundary is strict: "/administrator"
// does not match "/admin"—otherwise a string-level prefix check would produce
// false matches.
function stripBasePath(path: string, basePath: string): string | undefined {
  if (basePath === "") return path;
  if (path === basePath) return "/";
  if (path.startsWith(`${basePath}/`)) return path.slice(basePath.length);
  return undefined;
}

function prependBasePath(path: string, basePath: string): string {
  if (basePath === "") return path;
  // formatPath always returns an absolute in-app path: "/" or "/screen-id"
  // or "/screen-id/entity-id". "/" becomes basePath; otherwise, concatenate.
  if (path === "/" || path === "") return basePath;
  return `${basePath}${path}`;
}

// pushState does not fire popstate, so we maintain a listener set that
// navigate() notifies. Back/Forward navigation goes through a window listener
// wired exactly once.
const listeners = new Set<() => void>();
let popstateWired = false;
// URL the app currently shows; popstate has already moved the browser to the
// target by the time we can ask, so a declined leave must restore this one.
let committedUrl = "";

function readUrl(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

// Stable identity for the omitted-features case — `?? []` would create a
// fresh array every render, busting the useMemo below on every render for
// every existing useBrowserNavApi() call site (none of which pass features).
const NO_FEATURES: readonly FeatureSchema[] = [];

function ensurePopstateWired(): void {
  if (popstateWired) return;
  if (typeof window === "undefined") return;
  window.addEventListener("popstate", () => {
    if (!hasUnsavedInput()) {
      committedUrl = readUrl();
      for (const l of listeners) l();
      return;
    }
    const targetUrl = readUrl();
    window.history.pushState(null, "", committedUrl);
    requestLeave(() => {
      // replaceState, not history.back(): the declined entry is already ours
      // and a forward navigation would otherwise land on the wrong entry.
      window.history.replaceState(null, "", targetUrl);
      committedUrl = targetUrl;
      for (const l of listeners) l();
    });
  });
  window.addEventListener("beforeunload", (event) => {
    if (!hasUnsavedInput()) return;
    event.preventDefault();
    event.returnValue = "";
  });
  popstateWired = true;
}

function subscribe(listener: () => void): () => void {
  ensurePopstateWired();
  if (typeof window !== "undefined" && listeners.size === 0) committedUrl = readUrl();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readPath(): string {
  return typeof window !== "undefined" ? window.location.pathname : "/";
}

// Reads the current ?key=value pairs as a plain record. URLSearchParams-
// iterator yields String/String; when a key occurs more than once, the last
// value wins (`?a=1&a=2` → "2").
// Multi-value lists are not supported in Kumiko filter state; documenting this
// explicitly is preferable to providing unspecified behavior.
function readSearch(): string {
  return typeof window !== "undefined" ? window.location.search : "";
}

function parseSearchParams(search: string): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  if (search === "") return out;
  const params = new URLSearchParams(search);
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

// Merges updates into the current query string. `null` deletes a key; other
// values overwrite it. Uses replaceState rather than pushState—otherwise
// sort/filter toggles would flood Back navigation, forcing users through
// dozens of intermediate states to reach the previous page.
function applySearchParamUpdates(updates: Readonly<Record<string, string | null>>): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }
  const next = params.toString();
  const nextSearch = next === "" ? "" : `?${next}`;
  if (nextSearch === window.location.search) return;
  const url = `${window.location.pathname}${nextSearch}${window.location.hash}`;
  window.history.replaceState(null, "", url);
  committedUrl = readUrl();
  for (const l of listeners) l();
}

// undefined = the caller passed no search params; "" = an explicitly empty query.
function formatSearch(options: NavigateOptions | undefined): string | undefined {
  if (options?.searchParams === undefined) return undefined;
  const query = new URLSearchParams(options.searchParams).toString();
  return query === "" ? "" : `?${query}`;
}

function pushPath(path: string, search: string | undefined): void {
  if (typeof window === "undefined") return;
  // Repeated navigate() calls to the same URL must not flood the history.
  // Without explicit search params the current query counts as unchanged.
  const unchanged =
    window.location.pathname === path &&
    (search === undefined || window.location.search === search);
  if (unchanged) return;
  requestLeave(() => {
    window.history.pushState(null, "", `${path}${search ?? ""}`);
    committedUrl = readUrl();
    for (const l of listeners) l();
  });
}

function replacePath(path: string, search: string | undefined): void {
  if (typeof window === "undefined") return;
  // No path-change short-circuit here: callers explicitly chose replace
  // to avoid creating a history entry, even when the URL is identical.
  // (pushPath skips no-op pushes; replacePath honors the call so the
  // entry-stack semantics stay predictable.)
  const nextUrl = `${path}${search ?? ""}`;
  const leavesCurrentPage =
    window.location.pathname !== path ||
    (search !== undefined && window.location.search !== search);
  const apply = (): void => {
    window.history.replaceState(null, "", nextUrl);
    committedUrl = readUrl();
    for (const l of listeners) l();
  };
  if (leavesCurrentPage) requestLeave(apply);
  else apply();
}

/** React hook that builds a NavApi from browser history. It should be
 *  called once at the app root and passed as the value to the shared
 *  `<NavProvider>`—createKumikoApp does this.
 *
 *  Whether the schema has workspaces (schema.workspaces is non-empty) determines
 *  whether the first URL segment is parsed as a workspace ID. This is a pure
 *  pass-through to parsePath; formatPath checks target.workspaceId itself.
 *
 *  basePath mounts the app under a URL prefix (for example, "/admin"). The read
 *  path strips it before parsePath, and the write path prepends it before
 *  pushState/href. URLs outside basePath produce route=undefined without an
 *  automatic redirect.
 *
 *  Note the ambiguity of route=undefined with basePath:
 *  Both the app root (URL === basePath, for example, "/admin") and URLs
 *  outside basePath (for example, "/marketing") produce route=undefined. An
 *  app that must distinguish between "render Default-Screen" and "render
 *  Not-Found" must also inspect `window.location.pathname`:
 *
 *    if (window.location.pathname.startsWith("/admin")) {
 *      // in-app, but at the root → Default-Screen
 *    } else {
 *      // out-of-app → Not-Found / Marketing-Layer
 *    }
 *
 *  In non-basePath mode, this ambiguity does not arise—out-of-app is not a
 *  concept there. */
export function useBrowserNavApi(options?: {
  readonly hasWorkspaces?: boolean;
  readonly basePath?: string;
  /** Feature list ObjectTarget resolution needs (resolveTarget). Omit when
   *  the caller never passes an ObjectTarget — a ScreenTarget resolves
   *  without looking at the feature list at all. */
  readonly features?: readonly FeatureSchema[];
}): NavApi {
  const path = useSyncExternalStore(subscribe, readPath, () => "/");
  // Search is notified through the same listener set (popstate +
  // our replaceState calls), so we reuse the same subscribe function.
  // Both snapshots are recomputed together, preventing drift
  // between the path and query.
  const search = useSyncExternalStore(subscribe, readSearch, () => "");
  const hasWorkspaces = options?.hasWorkspaces === true;
  const basePath = useMemo(() => normalizeBasePath(options?.basePath), [options?.basePath]);
  const searchParams = useMemo(() => parseSearchParams(search), [search]);
  const inAppPath = useMemo(() => stripBasePath(path, basePath), [path, basePath]);
  const features = options?.features ?? NO_FEATURES;
  return useMemo<NavApi>(() => {
    const route = inAppPath === undefined ? undefined : parsePath(inAppPath, hasWorkspaces);
    // NavTarget contract: omitting workspaceId preserves the current workspace.
    // formatPath does not know the current route, so without this injection
    // `/screen-id` is parsed as a workspaceId by parsePath(hasWorkspaces),
    // causing WorkspaceShell to see an unknown workspace and immediately
    // revert to the default screen (a production bug where "click does nothing").
    const inCurrentWorkspace = (target: ScreenTarget): ScreenTarget =>
      hasWorkspaces && target.workspaceId === undefined && route?.workspaceId !== undefined
        ? { ...target, workspaceId: route.workspaceId }
        : target;
    // resolveTarget runs first so an ObjectTarget never reaches formatPath —
    // everything downstream (workspace-injection, path-building) only ever
    // sees the ScreenTarget shape it already knew about.
    const toPath = (target: NavTarget): string =>
      prependBasePath(formatPath(inCurrentWorkspace(resolveTarget(features, target))), basePath);
    return {
      route,
      navigate: (target, navigateOptions) =>
        pushPath(toPath(target), formatSearch(navigateOptions)),
      replace: (target, navigateOptions) =>
        replacePath(toPath(target), formatSearch(navigateOptions)),
      hrefFor: (target, navigateOptions) =>
        `${toPath(target)}${formatSearch(navigateOptions) ?? ""}`,
      searchParams,
      setSearchParams: applySearchParamUpdates,
    };
  }, [inAppPath, hasWorkspaces, basePath, searchParams, features]);
}

// ---- KumikoLink (anchor-based, web only) ----

export type KumikoLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  readonly to: NavTarget;
};

export function KumikoLink({ to, onClick, children, ...rest }: KumikoLinkProps): ReactNode {
  const nav = useNav();
  const handleClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e);
      if (e.defaultPrevented) return;
      // Preserve standard browser behavior for Cmd/Ctrl/Shift/Alt + middle-click;
      // only a plain left click is handled by navigate().
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      nav.navigate(to);
    },
    [nav, to, onClick],
  );
  return (
    <a href={nav.hrefFor(to)} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
