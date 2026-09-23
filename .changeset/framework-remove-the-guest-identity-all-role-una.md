---
"@cosmicdrift/kumiko-framework": minor
---

Remove the guest-identity all-role: unauthenticated handlers must declare roles: ["anonymous"] with a rateLimit

<!-- kumiko-changes
feature: framework
type: breaking
title: Remove the guest-identity all-role: unauthenticated handlers must declare roles: ["anonymous"] with a rateLimit
migration: |
  Handlers declared with access: { roles: ["all"] } now fail boot — no session ever carries the role "all", so this is unreachable dead config, not a wildcard. Switch to access: { roles: ["anonymous"] } plus rateLimit: { per: "ip" | "ip+handler", limit: N, windowSeconds: N } for unauthenticated callers, or access: { openToAll: { reason: "..." } } for any signed-in user. Test fixtures that hand-roll a SessionUser with roles: ["all"] (bridgeStub, hand-rolled guest literals) must switch to createAnonymousUser(tenantId) or roles: ["anonymous"]. buildSessionRoles now also strips "anonymous" and "all" out of globalRoles at every JWT mint (membership roles were already stripped). auth-routes.ts now dispatches every public /auth/* write with createAnonymousUser(SYSTEM_TENANT_ID) instead of the removed GUEST_USER constant.
-->
