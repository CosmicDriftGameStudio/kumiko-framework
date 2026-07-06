// @runtime client
// MembersScreen — active members + pending invitations for the current tenant.
// Read-only member list; invite + cancel only (no updateMemberRoles — SystemAdmin-only).

import { AuthHandlers } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/constants";
import { useDispatcher, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { DEFAULT_INVITE_ROLE_OPTIONS, TenantHandlers, TenantQueries } from "../constants";

type MemberRow = {
  readonly id: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly roles: readonly string[];
};

type InvitationRow = {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly status: string;
  readonly expiresAt: string;
};

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly members: readonly MemberRow[];
      readonly invitations: readonly InvitationRow[];
    };

type RoleOption = (typeof DEFAULT_INVITE_ROLE_OPTIONS)[number];

export type MembersScreenProps = {
  /** Invite-role allowlist; defaults to User/Admin/Editor — never reserved/global roles. */
  readonly inviteRoleOptions?: readonly RoleOption[];
};

export function MembersScreen({
  inviteRoleOptions = DEFAULT_INVITE_ROLE_OPTIONS,
}: MembersScreenProps): ReactNode {
  const t = useTranslation();
  const dispatcher = useDispatcher();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<RoleOption>(inviteRoleOptions[0] ?? "User");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastInvited, setLastInvited] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const membersRes = await dispatcher.query<readonly MemberRow[]>(TenantQueries.members, {});
    if (!membersRes.isSuccess) {
      setState({ kind: "error", message: membersRes.error.message });
      return;
    }
    const invitationsRes = await dispatcher.query<readonly InvitationRow[]>(
      TenantQueries.invitations,
      {},
    );
    if (!invitationsRes.isSuccess) {
      setState({ kind: "error", message: invitationsRes.error.message });
      return;
    }
    setState({ kind: "ready", members: membersRes.data, invitations: invitationsRes.data });
  }, [dispatcher]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onInvite = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setActionError(null);
    setSubmitting(true);
    const email = inviteEmail.trim();
    const res = await dispatcher.write(AuthHandlers.inviteCreate, { email, role: inviteRole });
    setSubmitting(false);
    if (!res.isSuccess) {
      setActionError(res.error.message);
      return;
    }
    setLastInvited(email);
    setInviteEmail("");
    await refresh();
  };

  const onCancel = async (invitationId: string): Promise<void> => {
    setActionError(null);
    const res = await dispatcher.write(TenantHandlers.cancelInvitation, { invitationId });
    if (!res.isSuccess) {
      setActionError(res.error.message);
      return;
    }
    await refresh();
  };

  if (state.kind === "loading") return <p>{t("tenant.members.loading")}</p>;
  if (state.kind === "error") return <p style={{ color: "#b91c1c" }}>{state.message}</p>;

  return (
    <div data-testid="members-screen" className="p-6 flex flex-col gap-6 max-w-3xl">
      <h1 className="text-2xl font-semibold m-0">{t("tenant.members.title")}</h1>

      <section className="border rounded-lg p-4 bg-card">
        <h2 className="text-lg font-medium mt-0">
          {t("tenant.members.active")} ({state.members.length})
        </h2>
        <table className="w-full text-sm mt-4">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">{t("tenant.members.col.userId")}</th>
              <th className="p-2">{t("tenant.members.col.roles")}</th>
            </tr>
          </thead>
          <tbody>
            {state.members.map((m) => (
              <tr key={m.id} className="border-b border-muted">
                <td className="p-2">
                  <code>{m.userId}</code>
                </td>
                <td className="p-2">{m.roles.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="border rounded-lg p-4 bg-card" data-testid="invite-form">
        <h2 className="text-lg font-medium mt-0">{t("tenant.members.invite.title")}</h2>
        <form onSubmit={onInvite} className="grid gap-3 sm:grid-cols-[1fr_150px_auto] items-end mt-4">
          <label className="flex flex-col gap-1 text-sm">
            {t("tenant.members.invite.email")}
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              disabled={submitting}
              className="border rounded px-2 py-1"
              data-testid="invite-email"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("tenant.members.invite.role")}
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as RoleOption)}
              disabled={submitting}
              className="border rounded px-2 py-1"
              data-testid="invite-role"
            >
              {inviteRoleOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="bg-primary text-primary-foreground rounded px-4 py-2 font-medium"
            data-testid="invite-submit"
          >
            {submitting ? t("tenant.members.invite.submitting") : t("tenant.members.invite.submit")}
          </button>
        </form>
        {lastInvited !== null && !submitting && (
          <p className="text-sm text-green-700 mt-2">
            {t("tenant.members.invite.success", { email: lastInvited })}
          </p>
        )}
        {actionError !== null && (
          <p className="text-sm text-destructive mt-2">{actionError}</p>
        )}
      </section>

      <section className="border rounded-lg p-4 bg-card">
        <h2 className="text-lg font-medium mt-0">
          {t("tenant.members.pending")} ({state.invitations.length})
        </h2>
        {state.invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("tenant.members.pending.empty")}</p>
        ) : (
          <table className="w-full text-sm mt-4" data-testid="pending-list">
            <thead>
              <tr className="border-b text-left">
                <th className="p-2">{t("tenant.members.col.email")}</th>
                <th className="p-2">{t("tenant.members.col.roles")}</th>
                <th className="p-2">{t("tenant.members.col.expires")}</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {state.invitations.map((inv) => (
                <tr key={inv.id} data-invitation-id={inv.id}>
                  <td className="p-2">{inv.email}</td>
                  <td className="p-2">{inv.role}</td>
                  <td className="p-2">{formatExpiresAt(inv.expiresAt)}</td>
                  <td className="p-2">
                    <button
                      type="button"
                      onClick={() => void onCancel(inv.id)}
                      className="text-destructive border border-destructive/30 rounded px-2 py-1 text-xs"
                      data-testid={`cancel-${inv.email}`}
                    >
                      {t("tenant.members.cancel")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function formatExpiresAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
