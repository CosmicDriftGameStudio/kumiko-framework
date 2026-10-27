// Scope visibility: shared rows (`ownerUserId=null`) are visible to any authorized caller;
// personal rows are visible only to the owner, `TenantAdmin`, or `SystemAdmin` for compliance.
// The same rule applies to `read_mail_accounts` and `read_inbound_messages`.

export function isVisibleToCaller(
  row: Readonly<Record<string, unknown>>,
  user: { readonly id: string; readonly roles: readonly string[] },
): boolean {
  const owner = row["ownerUserId"];
  if (owner == null || owner === "") return true;
  if (owner === user.id) return true;
  return user.roles.includes("TenantAdmin") || user.roles.includes("SystemAdmin");
}

export function isMailAdmin(user: { readonly roles: readonly string[] }): boolean {
  return user.roles.includes("TenantAdmin") || user.roles.includes("SystemAdmin");
}

// A personal mailbox is re-armed (and its sender check changed) by its owner only: a reconnect
// re-reads the owner's mail with whatever credential the caller supplies, so an admin must not do
// it. A shared mailbox belongs to the tenant: admins only.
export function mayReactivateMailbox(
  ownerUserId: unknown,
  user: { readonly id: string; readonly roles: readonly string[] },
): boolean {
  if (ownerUserId == null || ownerUserId === "") return isMailAdmin(user);
  return ownerUserId === user.id;
}

// Quarantine entries of a shared mailbox are administered by admins; those of a personal mailbox by
// its owner (and admins, as for reading).
export function mayManageQuarantine(
  ownerUserId: string | null,
  user: { readonly id: string; readonly roles: readonly string[] },
): boolean {
  return ownerUserId === null ? isMailAdmin(user) : isVisibleToCaller({ ownerUserId }, user);
}
