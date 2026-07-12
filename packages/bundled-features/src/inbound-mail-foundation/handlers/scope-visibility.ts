// Scope-Sichtbarkeit (Plan Entscheidung 2): shared-Rows
// (ownerUserId=null) sieht jeder Berechtigte; persönliche nur der Owner
// selbst + TenantAdmin/SystemAdmin (Compliance-Sicht). Gilt identisch
// für read_mail_accounts und read_inbound_messages (Scope-Vererbung).

export function isVisibleToCaller(
  row: unknown,
  user: { readonly id: string; readonly roles: readonly string[] },
): boolean {
  const owner = (row as Record<string, unknown>)["ownerUserId"];
  if (owner == null || owner === "") return true;
  if (owner === user.id) return true;
  return user.roles.includes("TenantAdmin") || user.roles.includes("SystemAdmin");
}
