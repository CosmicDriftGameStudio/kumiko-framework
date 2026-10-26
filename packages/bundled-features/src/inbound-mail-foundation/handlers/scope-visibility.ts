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

// A personal mailbox is re-armed by its owner only: a reconnect re-reads the owner's mail with
// whatever credential the caller supplies, so an admin must not do it. Shared mailboxes: any admin.
// The admin role itself is enforced by the handler and screen access.
export function mayReactivateMailbox(ownerUserId: unknown, callerId: string): boolean {
  return ownerUserId == null || ownerUserId === "" || ownerUserId === callerId;
}

// Quarantine entries of a shared mailbox are administered by admins; those of a personal mailbox by
// its owner (and admins, as for reading).
export function mayManageQuarantine(
  ownerUserId: string | null,
  user: { readonly id: string; readonly roles: readonly string[] },
): boolean {
  const isAdmin = user.roles.includes("TenantAdmin") || user.roles.includes("SystemAdmin");
  return ownerUserId === null ? isAdmin : isVisibleToCaller({ ownerUserId }, user);
}
