import type { AccessRule } from "./handlers";

// Workspace declaration. A workspace is a persona-/role-scoped UI surface:
// pure UI composition with no backend, DB or auth impact. The engine stores
// these verbatim and the active web shell (shellWorkspaces) renders the
// switcher and filters the nav tree by membership + access.
//
// Membership is computed from two sources, merged at boot:
//   1. r.workspace({ nav: [...] }) — explicit list of nav QNs
//   2. r.nav({ workspaces: [...] }) — nav entry self-assigns to workspaces
// A nav entry that appears in neither source belongs to no workspace and
// only shows up when no workspace is active (legacy / non-workspace apps).
//
// Cross-feature references are allowed: `nav` may point at any registered
// nav QN. The boot validator checks references exist and that workspace
// IDs referenced from r.nav are real.
export type WorkspaceDefinition = {
  // Feature author writes the short id ("disposition"); the registry
  // overwrites `id` with the qualified name ("bmc:workspace:disposition")
  // in its stored copy. Same pattern as NavDefinition / ScreenDefinition.
  readonly id: string;
  // i18n translation key. Resolved at render time by the renderer's
  // useTranslation hook; engine keeps it opaque.
  readonly label: string;
  // Icon key — whatever the icon registry of the active renderer understands.
  // Engine doesn't validate; unknown icons surface as a missing icon on
  // screen, not a boot failure (mirrors NavDefinition.icon).
  readonly icon?: string;
  // Sort weight in the workspace switcher (lower = earlier). Ties broken
  // by registration order — features registered later appear lower.
  readonly order?: number;
  // Role / openToAll gate. Only users matching this rule see the workspace
  // in their switcher. Mirrors NavDefinition.access — same semantics across
  // the UI surface, so a default-deny app can do `{ roles: [] }`.
  readonly access?: AccessRule;
  // Explicit nav QNs that belong to this workspace. Merged with any nav
  // entries that self-assign via r.nav({ workspaces: [...] }).
  readonly nav?: readonly string[];
  // Default workspace at login when the user has access to multiple. Boot
  // validator rejects more than one default per app.
  readonly default?: boolean;
};
