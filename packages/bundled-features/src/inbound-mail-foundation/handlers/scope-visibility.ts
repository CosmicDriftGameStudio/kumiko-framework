// Scope visibility: shared rows (`ownerUserId=null`) are visible to any authorized caller.
// A personal mailbox is private to its owner: its messages, bodies, attachments and quarantine are
// never shown to admins, who see only the operational metadata of the account (address, status).

type Caller = { readonly id: string; readonly roles: readonly string[] };

function isShared(ownerUserId: unknown): boolean {
  return ownerUserId == null || ownerUserId === "";
}

export function isVisibleToCaller(row: Readonly<Record<string, unknown>>, user: Caller): boolean {
  const owner = row["ownerUserId"];
  return isShared(owner) || owner === user.id;
}

export function isMailAdmin(
  user: { readonly roles: readonly string[] },
  adminRoles: readonly string[],
): boolean {
  return adminRoles.some((role) => user.roles.includes(role));
}

// Account metadata (not content) of a personal mailbox stays visible to admins for operations.
export function isAccountListableBy(
  row: Readonly<Record<string, unknown>>,
  user: Caller,
  adminRoles: readonly string[],
): boolean {
  return isVisibleToCaller(row, user) || isMailAdmin(user, adminRoles);
}

// A personal mailbox is re-armed (and its sender check changed) by its owner only: a reconnect
// re-reads the owner's mail with whatever credential the caller supplies, so an admin must not do
// it. A shared mailbox belongs to the tenant: admins only.
export function mayReactivateMailbox(
  ownerUserId: unknown,
  user: Caller,
  adminRoles: readonly string[],
): boolean {
  if (isShared(ownerUserId)) return isMailAdmin(user, adminRoles);
  return ownerUserId === user.id;
}

// Quarantine entries carry sender and subject of the mail, so those of a personal mailbox are the
// owner's alone; shared mailboxes are administered by admins.
export function mayManageQuarantine(
  ownerUserId: string | null,
  user: Caller,
  adminRoles: readonly string[],
): boolean {
  return isShared(ownerUserId) ? isMailAdmin(user, adminRoles) : ownerUserId === user.id;
}
