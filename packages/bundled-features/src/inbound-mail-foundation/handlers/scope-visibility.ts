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
