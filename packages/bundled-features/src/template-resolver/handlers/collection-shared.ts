import type { AccessRule, SessionUser } from "@cosmicdrift/kumiko-framework/engine";

// Applies when an app mounts a collection without saying who may reach it.
// Deliberately narrow: a collection whose access nobody decided should be
// invisible to normal users rather than open by default.
export const DEFAULT_COLLECTION_ACCESS: AccessRule = { roles: ["TenantAdmin", "SystemAdmin"] };

// `ownership: "user"` means every user keeps their own entries (signatures);
// "tenant" means one shared set (reply snippets an admin curates).
//
// The user-owned column doesn't exist yet — see #1770. Until it does, a
// user-owned collection would silently behave like a tenant-wide one, so the
// feature factory rejects `ownership: "user"` at registration time and this
// helper never sees it.
export function ownerFilter(
  isUserOwned: boolean,
  _user: SessionUser,
): Readonly<Record<string, unknown>> {
  if (!isUserOwned) return {};
  throw new Error(
    "template-resolver: ownership 'user' needs the ownerId column (#1770) — " +
      "createTemplateResolverFeature should have rejected this collection at mount.",
  );
}
